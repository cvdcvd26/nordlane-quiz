import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { Db } from "@/db";
import { badRequest, conflict, forbidden } from "../errors";
import { getSettings } from "../settings";
import { chatConfig, uploadConfig } from "@/config/settings";
import { content } from "@/config/content";
import { toPublicFile, type PublicFile } from "./uploads";
import { touchConversation, refreshLeadStats } from "./conversation";
import { deliverOverdue } from "./delivery";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ChatMessage = {
  id: string;
  sender: "visitor" | "admin" | "system";
  body: string;
  createdAt: string;
  clientMessageId: string;
  files: PublicFile[];
};

export const messageSchema = z.object({
  clientMessageId: z.string().min(8).max(100),
  body: z.string().max(chatConfig.maxMessageLength, content.errors.messageTooLong).default(""),
  fileIds: z.array(z.string().uuid()).max(uploadConfig.maxFilesPerMessage).default([]),
});

export async function getConversationBySession(sessionId: string) {
  const [c] = await db()
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.sessionId, sessionId))
    .limit(1);
  return c ?? null;
}

/** Messages of one conversation with their attachments. Internal notes live in another table and are never included. */
export async function loadMessages(conversationId: string, after?: Date): Promise<ChatMessage[]> {
  const rows = await db()
    .select()
    .from(schema.messages)
    .where(
      and(eq(schema.messages.conversationId, conversationId), after ? gt(schema.messages.createdAt, after) : undefined),
    )
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    .limit(500);
  if (rows.length === 0) return [];
  const attached = await db()
    .select()
    .from(schema.files)
    .where(inArray(schema.files.messageId, rows.map((r) => r.id)));
  return rows.map((m) => ({
    id: m.id,
    sender: m.sender,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    clientMessageId: m.clientMessageId,
    files: attached.filter((f) => f.messageId === m.id).map(toPublicFile),
  }));
}

export async function getVisitorChat(sessionId: string, after?: Date) {
  const conv = await getConversationBySession(sessionId);
  if (!conv) throw forbidden(content.errors.notSubmitted);
  // Backup delivery if the queue missed it.
  await deliverOverdue({ conversationId: conv.id, limit: 3 }).catch(() => {});
  const settings = await getSettings();
  return {
    messages: await loadMessages(conv.id, after),
    attachmentsEnabled: settings.chatAttachmentsEnabled,
  };
}

/**
 * Visitor sends a message. Idempotent by clientMessageId.
 * The lead is created on the visitor's first message once the automatic message has been
 * delivered (or right away if automatic messages are disabled) — exactly once, thanks to
 * the unique index on leads.session_id.
 */
export async function postVisitorMessage(sessionId: string, input: unknown): Promise<{ message: ChatMessage; leadId: number | null }> {
  const { clientMessageId, body, fileIds } = messageSchema.parse(input);
  const text = body.trim();
  if (!text && fileIds.length === 0) throw badRequest(content.errors.messageEmpty);

  const conv = await getConversationBySession(sessionId);
  if (!conv) throw forbidden(content.errors.notSubmitted);
  const settings = await getSettings();
  if (fileIds.length && !settings.chatAttachmentsEnabled) throw badRequest(content.errors.attachmentsDisabled);

  const now = new Date();
  const leadId = await db().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.messages)
      .values({ conversationId: conv.id, sender: "visitor", body: text, clientMessageId, createdAt: now })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return conv.leadId; // retry of an already stored message

    await attachFiles(tx, { fileIds, sessionId, messageId: inserted.id, uploadedBy: "visitor" });

    let leadId = conv.leadId;
    if (!leadId && (await leadEligible(tx, conv.id))) {
      await tx.insert(schema.leads).values({ sessionId, createdAt: now, updatedAt: now }).onConflictDoNothing();
      const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.sessionId, sessionId)).limit(1);
      leadId = lead.id;
      await tx.update(schema.conversations).set({ leadId }).where(eq(schema.conversations.id, conv.id));
      await refreshLeadStats(tx, leadId, conv.id);
    }
    await touchConversation(tx, conv.id, now);
    return leadId;
  });

  const [msg] = await db()
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.clientMessageId, clientMessageId)))
    .limit(1);
  const [message] = await loadMessages(conv.id, new Date(msg.createdAt.getTime() - 1)).then((list) =>
    list.filter((m) => m.id === msg.id),
  );
  return { message, leadId: leadId ?? null };
}

async function leadEligible(tx: Tx, conversationId: string) {
  const [sched] = await tx
    .select({ status: schema.scheduledMessages.status })
    .from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.conversationId, conversationId))
    .limit(1);
  // No scheduled message (auto messages were off at submission) or it was cancelled → reply counts right away.
  if (!sched || sched.status === "cancelled") return true;
  return sched.status === "sent";
}

export async function attachFiles(
  tx: Tx,
  p: { fileIds: string[]; sessionId: string; messageId: string; uploadedBy: "visitor" | "admin" },
) {
  if (p.fileIds.length === 0) return;
  const updated = await tx
    .update(schema.files)
    .set({ messageId: p.messageId })
    .where(
      and(
        inArray(schema.files.id, p.fileIds),
        eq(schema.files.sessionId, p.sessionId),
        eq(schema.files.purpose, "chat"),
        eq(schema.files.uploadedBy, p.uploadedBy),
        isNull(schema.files.messageId),
      ),
    )
    .returning({ id: schema.files.id });
  if (updated.length !== new Set(p.fileIds).size) throw conflict(content.errors.fileMissing, "file_missing");
}
