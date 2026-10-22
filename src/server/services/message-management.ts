import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { chatConfig } from "@/config/settings";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { lockVisitor } from "../session-lock";
import { storage } from "../storage";
import { refreshLeadStats } from "./conversation";

const text = z.string().max(chatConfig.maxMessageLength);
export const editMessageSchema = z.object({ body: text, expectedBody: text }).strict();
export const deleteMessageSchema = z.object({ expectedBody: text }).strict();

async function purgeFile(file: { id: string; storageKey: string }) {
  try {
    await storage().delete(file.storageKey);
    await db().delete(schema.files).where(eq(schema.files.id, file.id));
    return true;
  } catch {
    // Files remain inaccessible even if external cleanup must be retried.
    console.warn("messages.attachment_cleanup_pending");
    return false;
  }
}

/** Retry private-blob cleanup after temporary storage failures. */
export async function purgeDeletedMessageFiles(limit = 30) {
  const files = await db().select({ id: schema.files.id, storageKey: schema.files.storageKey }).from(schema.files)
    .innerJoin(schema.messages, eq(schema.messages.id, schema.files.messageId))
    .where(isNotNull(schema.messages.deletedAt)).limit(limit);
  let deleted = 0;
  for (const file of files) if (await purgeFile(file)) deleted++;
  return { deleted, pending: files.length - deleted };
}

/** Only manual administrator messages can be changed; a tombstone preserves send idempotency. */
export async function changeAdminMessage(leadId: number, messageId: string, action: "edit" | "delete", input: unknown) {
  if (!z.uuid().safeParse(messageId).success) throw notFound();
  const parsed = action === "edit" ? editMessageSchema.parse(input) : deleteMessageSchema.parse(input);
  const [lead] = await db().select({ sessionId: schema.leads.sessionId }).from(schema.leads).where(eq(schema.leads.id, leadId));
  if (!lead) throw notFound();
  const result = await db().transaction(async tx => {
    await lockVisitor(tx, lead.sessionId);
    const [conversation] = await tx.select().from(schema.conversations).where(eq(schema.conversations.sessionId, lead.sessionId));
    if (!conversation) throw notFound();
    const [message] = await tx.select().from(schema.messages).where(and(eq(schema.messages.id, messageId), eq(schema.messages.conversationId, conversation.id)));
    if (!message) throw notFound();
    if (message.sender !== "admin") throw forbidden("Only manual administrator messages can be changed.");
    const files = await tx.select({ id: schema.files.id, storageKey: schema.files.storageKey }).from(schema.files).where(eq(schema.files.messageId, messageId));
    if (message.deletedAt) {
      if (action === "edit") throw conflict("The message changed. Reload the conversation.", "message_changed");
      return { id: message.id, body: "", changeRevision: message.changeRevision, deleted: true, files };
    }
    const body = action === "edit" ? editMessageSchema.parse(parsed).body.trim() : "";
    if (action === "edit" && !body && !files.length) throw badRequest("A message must contain text or an attachment.", "message_empty");
    // A retry of an already successful edit must not create a second change.
    if (action === "edit" && body === message.body) return { id: message.id, body, changeRevision: message.changeRevision, deleted: false, files: [] };
    if (parsed.expectedBody !== message.body) throw conflict("The message changed. Reload the conversation.", "message_changed");
    const [updated] = await tx.update(schema.conversations).set({ messageRevision: sql`${schema.conversations.messageRevision} + 1` })
      .where(eq(schema.conversations.id, conversation.id)).returning({ revision: schema.conversations.messageRevision });
    await tx.update(schema.messages).set({ body, changeRevision: updated.revision, deletedAt: action === "delete" ? new Date() : null })
      .where(eq(schema.messages.id, messageId));
    if (action === "delete") await tx.update(schema.conversations).set({ lastMessageAt: sql`(select max(m.created_at) from messages m where m.conversation_id = ${conversation.id} and m.deleted_at is null)` })
      .where(eq(schema.conversations.id, conversation.id));
    await refreshLeadStats(tx, leadId, conversation.id);
    return { id: message.id, body, changeRevision: updated.revision, deleted: action === "delete", files: action === "delete" ? files : [] };
  });
  for (const file of result.files) await purgeFile(file);
  return { id: result.id, body: result.body, changeRevision: result.changeRevision, deleted: result.deleted };
}
