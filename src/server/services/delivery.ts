import { lockVisitor } from "../session-lock";
import { and, eq, lte, or, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "../settings";
import { log } from "../log";
import { touchConversation } from "./conversation";

const LOCK_TIMEOUT_MS = 2 * 60_000;

export type DeliveryOutcome = "sent" | "already_sent" | "not_due" | "cancelled" | "busy" | "not_found";

/** Claim, write and finish in one transaction: a process crash rolls the claim back. */
export async function deliverScheduledMessage(id: string, now = new Date()): Promise<DeliveryOutcome> {
  const settings = await getSettings();
  const t = schema.scheduledMessages;
  const [job] = await db().select({ sessionId: schema.conversations.sessionId }).from(t)
    .innerJoin(schema.conversations, eq(schema.conversations.id, t.conversationId)).where(eq(t.id, id));
  if (!job) return "not_found";
  try {
    return await db().transaction(async (tx): Promise<DeliveryOutcome> => {
      await lockVisitor(tx, job.sessionId);
      const [row] = await tx.select().from(t).where(eq(t.id, id)).for("update");
      if (!row) return "not_found";
      if (row.status === "sent") return "already_sent";
      if (row.status === "cancelled") return "cancelled";
      if (row.scheduledFor.getTime() > now.getTime()) return "not_due";
      if (row.status === "sending" && row.lockedAt && row.lockedAt.getTime() >= now.getTime() - LOCK_TIMEOUT_MS) return "busy";
      if (!settings.autoMessageEnabled) {
        await tx.update(t).set({ status: "cancelled", lockedAt: null, lastError: "auto message disabled" }).where(eq(t.id, id));
        return "cancelled";
      }
      const clientMessageId = `scheduled:${id}`;
      await tx.insert(schema.messages).values({
        conversationId: row.conversationId, sender: "system", body: settings.autoMessageText, clientMessageId,
      }).onConflictDoNothing();
      const [message] = await tx.select({ id: schema.messages.id }).from(schema.messages)
        .where(and(eq(schema.messages.conversationId, row.conversationId), eq(schema.messages.clientMessageId, clientMessageId)));
      await tx.update(t).set({ status: "sent", attempts: sql`${t.attempts} + 1`, sentAt: new Date(),
        messageId: message.id, lockedAt: null, lastError: null }).where(eq(t.id, id));
      await touchConversation(tx, row.conversationId, new Date());
      return "sent";
    });
  } catch (err) {
    log.error("scheduler", "delivery failed", err, { id });
    await db().update(t).set({ status: "pending", lockedAt: null, attempts: sql`${t.attempts} + 1`,
      lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      .where(and(eq(t.id, id), or(eq(t.status, "pending"), eq(t.status, "failed"),
        and(eq(t.status, "sending"), or(lt(t.lockedAt, new Date(now.getTime() - LOCK_TIMEOUT_MS)), sql`${t.lockedAt} is null`)))));
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
        or(eq(t.status, "pending"), eq(t.status, "failed"),
          and(eq(t.status, "sending"), or(lt(t.lockedAt, new Date(now.getTime() - LOCK_TIMEOUT_MS)), sql`${t.lockedAt} is null`))),
        lte(t.scheduledFor, now),
        opts.conversationId ? eq(t.conversationId, opts.conversationId) : undefined,
      ),
    )
    .orderBy(t.scheduledFor, t.id)
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
