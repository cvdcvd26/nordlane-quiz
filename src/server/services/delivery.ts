import { and, eq, lte, or, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "../settings";
import { log } from "../log";
import { touchConversation } from "./conversation";

const LOCK_TIMEOUT_MS = 2 * 60_000;
/** QStash may deliver a few seconds early; accept that small drift. */
const EARLY_TOLERANCE_MS = 15_000;

export type DeliveryOutcome = "sent" | "already_sent" | "not_due" | "cancelled" | "busy" | "not_found";

/**
 * Delivers one scheduled message exactly once.
 * 1) atomically claims the row (pending → sending), so parallel/retried calls can't both proceed;
 * 2) inserts the system message with a deterministic client id (unique per conversation),
 *    so even a crash between steps can't produce a duplicate;
 * 3) marks the row as sent. On error the row returns to `pending` and the caller returns 5xx → queue retries.
 */
export async function deliverScheduledMessage(id: string, now = new Date()): Promise<DeliveryOutcome> {
  const settings = await getSettings();
  const t = schema.scheduledMessages;

  const [row] = await db().select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) return "not_found";
  if (row.status === "sent") return "already_sent";
  if (row.status === "cancelled") return "cancelled";
  if (row.scheduledFor.getTime() - now.getTime() > EARLY_TOLERANCE_MS) return "not_due";

  if (!settings.autoMessageEnabled) {
    await db().update(t).set({ status: "cancelled", lastError: "auto message disabled" }).where(eq(t.id, id));
    return "cancelled";
  }

  const [claimed] = await db()
    .update(t)
    .set({ status: "sending", lockedAt: now, attempts: sql`${t.attempts} + 1` })
    .where(
      and(
        eq(t.id, id),
        or(
          eq(t.status, "pending"),
          eq(t.status, "failed"),
          and(eq(t.status, "sending"), lt(t.lockedAt, new Date(now.getTime() - LOCK_TIMEOUT_MS))),
        ),
      ),
    )
    .returning();
  if (!claimed) {
    const [cur] = await db().select({ status: t.status }).from(t).where(eq(t.id, id)).limit(1);
    return cur?.status === "sent" ? "already_sent" : "busy";
  }

  try {
    await db().transaction(async (tx) => {
      const clientMessageId = `scheduled:${id}`;
      await tx
        .insert(schema.messages)
        .values({
          conversationId: claimed.conversationId,
          sender: "system",
          body: settings.autoMessageText,
          clientMessageId,
          // Real send time (the `now` argument only drives the due/lock checks).
        })
        .onConflictDoNothing();
      const [msg] = await tx
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(
          and(eq(schema.messages.conversationId, claimed.conversationId), eq(schema.messages.clientMessageId, clientMessageId)),
        )
        .limit(1);
      await tx
        .update(t)
        .set({ status: "sent", sentAt: new Date(), messageId: msg.id, lockedAt: null, lastError: null })
        .where(eq(t.id, id));
      await touchConversation(tx, claimed.conversationId, new Date());
    });
    log.info("scheduler", "scheduled message sent", { id, attempts: claimed.attempts });
    return "sent";
  } catch (err) {
    log.error("scheduler", "delivery failed", err, { id, attempts: claimed.attempts });
    await db()
      .update(t)
      .set({
        status: "pending",
        lockedAt: null,
        lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      })
      .where(eq(t.id, id));
    throw err;
  }
}

/**
 * Backup path: delivers anything overdue (e.g. if enqueueing failed).
 * Called by the daily cron and opportunistically when a visitor opens the chat.
 */
export async function deliverOverdue(opts: { conversationId?: string; limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const t = schema.scheduledMessages;
  const due = await db()
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        or(eq(t.status, "pending"), eq(t.status, "failed")),
        lte(t.scheduledFor, new Date(now.getTime() - 60_000)),
        opts.conversationId ? eq(t.conversationId, opts.conversationId) : undefined,
      ),
    )
    .limit(opts.limit ?? 50);
  const results: Record<string, DeliveryOutcome | "error"> = {};
  for (const { id } of due) {
    try {
      results[id] = await deliverScheduledMessage(id, now);
    } catch {
      results[id] = "error";
    }
  }
  return results;
}
