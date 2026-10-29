import { and, asc, desc, eq, gt, lt, lte, inArray, isNull, notLike } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { Db } from "@/db";
import { badRequest, conflict } from "../errors";
import { getSettings } from "../settings";
import { chatConfig, uploadConfig } from "@/config/settings";
import { content } from "@/config/content";
import { revisionFilePrefix } from "@/config/task-revisions";
import { toPublicFile, type PublicFile } from "./uploads";
import { touchConversation, refreshLeadStats } from "./conversation";
import { ensureConversation, ensureLead } from "./leads";
import { deliverOverdue } from "./delivery";
import { lockVisitor } from "../session-lock";
import { getSessionManager } from "./managers";
import { assertVisitorChatOpen, getSessionOutcome } from "./candidate-outcome";
import { richTextSchema, type RichTextDocument } from "@/lib/rich-text";
import { requireVisitorChatAccess } from "./visitor-chat-access";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ChatMessage = {
  id: string;
  sequence: string;
  sender: "visitor" | "admin" | "system";
  body: string;
  bodyRich: RichTextDocument | null;
  createdAt: string;
  clientMessageId: string;
  changeRevision: number;
  files: PublicFile[];
};

export const messageSchema = z.object({
  clientMessageId: z.string().min(8).max(100),
  body: z.string().max(chatConfig.maxMessageLength, content.errors.messageTooLong).default(""),
  fileIds: z.array(z.string().uuid()).max(uploadConfig.maxFilesPerMessage).default([]),
});

/** Visitors keep a plain-text composer; rich formatting is accepted only on admin routes. */
export const adminMessageSchema = messageSchema.extend({ bodyRich: richTextSchema.nullable().optional() });

export async function getConversationBySession(sessionId: string) {
  const [c] = await db()
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.sessionId, sessionId))
    .limit(1);
  return c ?? null;
}

const cursorSchema = z.string().refine((s) => /^[1-9]\d{0,18}$/.test(s) && BigInt(s) <= BigInt("9223372036854775807"));
export const changeCursorSchema = z.string().regex(/^(0|[1-9]\d{0,9})$/).refine(value => Number(value) <= 2147483647);
export const messageQuerySchema = z.object({ after: cursorSchema.optional(), before: cursorSchema.optional(), changesAfter: changeCursorSchema.optional() })
  .refine((q) => !(q.after && q.before));
export type MessageQuery = z.infer<typeof messageQuerySchema>;

/** Stable, bounded pages. Initial loads show the newest page; before loads older history. */
export async function loadMessagePage(conversationId: string, input: MessageQuery = {}) {
  const query = messageQuerySchema.parse(input);
  const forward = Boolean(query.after);
  const rows = await db()
    .select()
    .from(schema.messages)
    .where(
      and(eq(schema.messages.conversationId, conversationId), isNull(schema.messages.deletedAt),
        query.after ? gt(schema.messages.sequence, BigInt(query.after)) : undefined,
        query.before ? lt(schema.messages.sequence, BigInt(query.before)) : undefined),
    )
    .orderBy(forward ? asc(schema.messages.sequence) : desc(schema.messages.sequence))
    .limit(chatConfig.pageSize + 1);
  const hasMore = rows.length > chatConfig.pageSize;
  const page = rows.slice(0, chatConfig.pageSize);
  if (!forward) page.reverse();
  return {
    messages: await hydrateMessages(page), hasMore,
    nextCursor: page.at(-1)?.sequence.toString() ?? query.after ?? null,
    previousCursor: page[0]?.sequence.toString() ?? null,
  };
}

export async function loadMessages(conversationId: string): Promise<ChatMessage[]> {
  return (await loadMessagePage(conversationId)).messages;
}

async function hydrateMessages(rows: (typeof schema.messages.$inferSelect)[]): Promise<ChatMessage[]> {
  if (!rows.length) return [];
  const attached = await db()
    .select()
    .from(schema.files)
    .where(inArray(schema.files.messageId, rows.map((r) => r.id)));
  return rows.map((m) => ({
    id: m.id,
    sequence: m.sequence.toString(),
    sender: m.sender,
    body: m.body,
    bodyRich: m.bodyRich,
    createdAt: m.createdAt.toISOString(),
    clientMessageId: m.clientMessageId,
    changeRevision: m.changeRevision,
    files: attached.filter((f) => f.messageId === m.id).map(toPublicFile),
  }));
}

/** A separate bounded cursor delivers edits/deletions without turning them into new messages. */
export async function loadMessageChanges(conversationId: string, revision: number, after?: string) {
  if (after === undefined) return { updates: [], deletedIds: [], cursor: String(revision), hasMore: false };
  const since = Number(changeCursorSchema.parse(after));
  const rows = await db().select().from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conversationId), gt(schema.messages.changeRevision, since), lte(schema.messages.changeRevision, revision)))
    .orderBy(asc(schema.messages.changeRevision)).limit(chatConfig.pageSize + 1);
  const page = rows.slice(0, chatConfig.pageSize);
  const hasMore = rows.length > chatConfig.pageSize;
  return {
    updates: await hydrateMessages(page.filter(message => !message.deletedAt)),
    deletedIds: page.filter(message => message.deletedAt).map(message => message.id),
    cursor: hasMore ? String(page.at(-1)!.changeRevision) : String(revision),
    hasMore,
  };
}

export async function getVisitorChat(sessionId: string, query: MessageQuery = {}) {
  await requireVisitorChatAccess(db(), sessionId);
  // Also repairs historical submissions that predate creation of leads at step one.
  await ensureLead(db(), sessionId);
  const conv = await ensureConversation(db(), sessionId);
  // Backup delivery if the queue missed it.
  await deliverOverdue({ conversationId: conv.id, limit: 3 }).catch(() => {});
  const settings = await getSettings();
  return {
    ...(await loadMessagePage(conv.id, query)),
    changes: await loadMessageChanges(conv.id, conv.messageRevision, query.changesAfter),
    manager: await getSessionManager(sessionId),
    outcome: await getSessionOutcome(sessionId),
    attachmentsEnabled: settings.chatAttachmentsEnabled,
  };
}

/**
 * Visitor sends a message. Idempotent by clientMessageId.
 * Reuses the lead created when the visitor saved contact details.
 */
export async function postVisitorMessage(sessionId: string, input: unknown): Promise<{ message: ChatMessage; leadId: number | null }> {
  const { clientMessageId, body, fileIds } = messageSchema.parse(input);
  const text = body.trim();
  if (!text && fileIds.length === 0) throw badRequest(content.errors.messageEmpty);

  await requireVisitorChatAccess(db(), sessionId);
  const conv = await ensureConversation(db(), sessionId);
  const settings = await getSettings();
  if (fileIds.length && !settings.chatAttachmentsEnabled) throw badRequest(content.errors.attachmentsDisabled);

  const now = new Date();
  const leadId = await db().transaction(async (tx) => {
    await lockVisitor(tx, sessionId);
    await requireVisitorChatAccess(tx, sessionId);
    await assertVisitorChatOpen(tx, sessionId);
    const [inserted] = await tx
      .insert(schema.messages)
      .values({ conversationId: conv.id, sender: "visitor", body: text, clientMessageId, createdAt: now })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return conv.leadId; // retry of an already stored message

    await attachFiles(tx, { fileIds, sessionId, messageId: inserted.id, uploadedBy: "visitor" });

    // Older visitors without a lead (e.g. data from before this rule) get one now.
    const leadId = conv.leadId ?? (await ensureLead(tx, sessionId));
    await touchConversation(tx, conv.id, now);
    await refreshLeadStats(tx, leadId, conv.id);
    return leadId;
  });

  const [msg] = await db()
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.clientMessageId, clientMessageId)))
    .limit(1);
  const [message] = await hydrateMessages([msg]);
  return { message, leadId: leadId ?? null };
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
        notLike(schema.files.storageKey, `${revisionFilePrefix(p.sessionId)}%`),
      ),
    )
    .returning({ id: schema.files.id });
  if (updated.length !== new Set(p.fileIds).size) throw conflict(content.errors.fileMissing, "file_missing");
}
