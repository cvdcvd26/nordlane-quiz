import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { db, schema } from "@/db";
import { revisionConfig, revisionErrors, revisionFilePrefix, type TaskRevision } from "@/config/task-revisions";
import { uploadConfig } from "@/config/settings";
import { content } from "@/config/content";
import { AppError, badRequest, conflict, notFound } from "../errors";
import { lockVisitor, type Transaction } from "../session-lock";
import { storage } from "../storage";
import { validateFile } from "../file-validation";
import { assertVisitorChatOpen, toCandidateOutcome } from "./candidate-outcome";
import { ensureConversation } from "./leads";
import { touchConversation } from "./conversation";
import { toPublicFile } from "./uploads";

export const requestRevisionSchema = z.object({
  id: z.uuid(),
  instructions: z.string().trim().min(1).max(revisionConfig.maxInstructionsLength),
  sendMessage: z.boolean().default(true),
}).strict();
export const revisionResponseSchema = z.object({
  revisionId: z.uuid(),
  body: z.string().trim().max(revisionConfig.maxResponseLength).default(""),
  fileIds: z.array(z.uuid()).max(uploadConfig.maxFilesPerSubmission).default([]),
}).strict().refine(value => Boolean(value.body || value.fileIds.length), { message: revisionErrors.empty });

type Row = typeof schema.taskRevisions.$inferSelect;
const publicRevision = (row: Row): TaskRevision => ({
  id: row.id, instructions: row.instructions, status: row.status as TaskRevision["status"],
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  submittedAt: row.submittedAt?.toISOString() ?? null,
});
const revisionPrefix = (sessionId: string, revisionId: string) => `${revisionFilePrefix(sessionId)}${revisionId}/`;
const pendingFilesWhere = (sessionId: string, revisionId: string) => and(
  eq(schema.files.sessionId, sessionId), eq(schema.files.purpose, "chat"), eq(schema.files.uploadedBy, "visitor"),
  isNull(schema.files.messageId), isNull(schema.files.submissionId), like(schema.files.storageKey, `${revisionPrefix(sessionId, revisionId)}%`),
);

async function leadFor(id: number) {
  const [lead] = await db().select().from(schema.leads).where(eq(schema.leads.id, id));
  if (!lead) throw notFound();
  return lead;
}

async function requireOriginal(tx: Transaction, sessionId: string) {
  const [submission] = await tx.select({ id: schema.taskSubmissions.id }).from(schema.taskSubmissions)
    .where(eq(schema.taskSubmissions.sessionId, sessionId));
  if (!submission) throw conflict(revisionErrors.notSubmitted, "revision_not_submitted");
}

/** Caller holds the same visitor lock as publication, cancellation, uploads and replies. */
async function requirePending(tx: Transaction, sessionId: string, revisionId: string) {
  await assertVisitorChatOpen(tx, sessionId);
  await requireOriginal(tx, sessionId);
  const [row] = await tx.select({ revision: schema.taskRevisions }).from(schema.taskRevisions)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.taskRevisions.leadId))
    .where(and(eq(schema.taskRevisions.id, revisionId), eq(schema.leads.sessionId, sessionId)));
  if (!row || row.revision.status !== "pending") throw conflict(revisionErrors.inactive, "revision_inactive");
  return row.revision;
}

async function requestTaskRevisionImpl(leadId: number, adminId: string, input: unknown) {
  const parsed = requestRevisionSchema.parse(input);
  const lead = await leadFor(leadId);
  return db().transaction(async tx => {
    await lockVisitor(tx, lead.sessionId);
    const [existing] = await tx.select().from(schema.taskRevisions).where(eq(schema.taskRevisions.id, parsed.id));
    if (existing) {
      if (existing.leadId !== leadId) throw conflict(revisionErrors.duplicate, "revision_duplicate");
      return publicRevision(existing);
    }
    await assertVisitorChatOpen(tx, lead.sessionId);
    await requireOriginal(tx, lead.sessionId);
    const [pending] = await tx.select({ id: schema.taskRevisions.id }).from(schema.taskRevisions)
      .where(and(eq(schema.taskRevisions.leadId, leadId), eq(schema.taskRevisions.status, "pending")));
    if (pending) throw conflict(revisionErrors.pending, "revision_pending");
    const [latest] = await tx.select({ createdAt: schema.taskRevisions.createdAt }).from(schema.taskRevisions)
      .where(eq(schema.taskRevisions.leadId, leadId)).orderBy(desc(schema.taskRevisions.createdAt)).limit(1);
    // A strict order also handles an immediate cancel/re-request within one millisecond.
    const now = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
    let requestMessageId: string | null = null;
    if (parsed.sendMessage) {
      const conv = await ensureConversation(tx, lead.sessionId);
      const [message] = await tx.insert(schema.messages).values({
        conversationId: conv.id, sender: "admin", body: parsed.instructions,
        clientMessageId: `revision-request:${parsed.id}:${randomUUID()}`, createdAt: now,
      }).returning();
      requestMessageId = message.id;
      await touchConversation(tx, conv.id, now);
    }
    const [row] = await tx.insert(schema.taskRevisions).values({
      id: parsed.id, leadId, instructions: parsed.instructions, createdBy: adminId, requestMessageId, createdAt: now, updatedAt: now,
    }).onConflictDoNothing().returning();
    if (!row) throw conflict(revisionErrors.duplicate, "revision_duplicate");
    await tx.update(schema.leads).set({ updatedAt: now }).where(eq(schema.leads.id, leadId));
    return publicRevision(row);
  });
}

async function cancelTaskRevisionImpl(leadId: number, revisionId: string) {
  if (!z.uuid().safeParse(revisionId).success) throw notFound();
  const lead = await leadFor(leadId);
  const result = await db().transaction(async tx => {
    await lockVisitor(tx, lead.sessionId);
    const [row] = await tx.select().from(schema.taskRevisions)
      .where(and(eq(schema.taskRevisions.id, revisionId), eq(schema.taskRevisions.leadId, leadId)));
    if (!row) throw notFound();
    if (row.status === "submitted") throw conflict(revisionErrors.changed, "revision_changed");
    if (row.status === "cancelled") return publicRevision(row);
    const now = new Date();
    const [updated] = await tx.update(schema.taskRevisions).set({ status: "cancelled", updatedAt: now })
      .where(and(eq(schema.taskRevisions.id, revisionId), eq(schema.taskRevisions.status, "pending"))).returning();
    await tx.update(schema.leads).set({ updatedAt: now }).where(eq(schema.leads.id, leadId));
    return publicRevision(updated);
  });
  await cleanupSessionDrafts(lead.sessionId);
  return result;
}

async function getLeadRevisionsImpl(leadId: number) {
  const lead = await leadFor(leadId);
  const [original] = await db().select({ id: schema.taskSubmissions.id }).from(schema.taskSubmissions)
    .where(eq(schema.taskSubmissions.sessionId, lead.sessionId));
  const rows = await db().select().from(schema.taskRevisions).where(eq(schema.taskRevisions.leadId, leadId))
    .orderBy(desc(schema.taskRevisions.createdAt));
  const messageIds = rows.flatMap(row => row.responseMessageId ? [row.responseMessageId] : []);
  const messages = messageIds.length ? await db().select().from(schema.messages).where(inArray(schema.messages.id, messageIds)) : [];
  const files = messageIds.length ? await db().select().from(schema.files).where(inArray(schema.files.messageId, messageIds)) : [];
  return {
    hasSubmission: Boolean(original), closed: Boolean(toCandidateOutcome(lead)),
    revisions: rows.map(row => ({ ...publicRevision(row), response: row.responseMessageId ? {
      body: messages.find(message => message.id === row.responseMessageId)?.body ?? "",
      files: files.filter(file => file.messageId === row.responseMessageId).map(toPublicFile),
    } : null })),
  };
}

async function getVisitorRevisionImpl(sessionId: string) {
  const [lead] = await db().select().from(schema.leads).where(eq(schema.leads.sessionId, sessionId));
  if (!lead || toCandidateOutcome(lead)) return { revision: null, files: [] };
  const [row] = await db().select().from(schema.taskRevisions).where(eq(schema.taskRevisions.leadId, lead.id))
    .orderBy(desc(schema.taskRevisions.createdAt)).limit(1);
  const files = row?.status === "pending" ? await db().select().from(schema.files).where(pendingFilesWhere(sessionId, row.id)).orderBy(schema.files.createdAt) : [];
  return { revision: row ? publicRevision(row) : null, files: files.map(toPublicFile) };
}

/** One immutable visitor message per revision; retries return the original result. */
async function submitTaskRevisionImpl(sessionId: string, input: unknown) {
  const parsed = revisionResponseSchema.parse(input);
  const result = await db().transaction(async tx => {
    await lockVisitor(tx, sessionId);
    const [existing] = await tx.select({ revision: schema.taskRevisions }).from(schema.taskRevisions)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.taskRevisions.leadId))
      .where(and(eq(schema.taskRevisions.id, parsed.revisionId), eq(schema.leads.sessionId, sessionId)));
    if (existing?.revision.status === "submitted") return publicRevision(existing.revision);
    const revision = await requirePending(tx, sessionId, parsed.revisionId);
    const conv = await ensureConversation(tx, sessionId);
    const now = new Date();
    const [message] = await tx.insert(schema.messages).values({
      conversationId: conv.id, sender: "visitor", body: parsed.body || "Przesyłam poprawione zrzuty ekranu.",
      // The revision row supplies idempotency. A random suffix prevents an ordinary
      // chat send from reserving this id before the corrected response is posted.
      clientMessageId: `revision-response:${revision.id}:${randomUUID()}`, createdAt: now,
    }).returning();
    if (parsed.fileIds.length) {
      const attached = await tx.update(schema.files).set({ messageId: message.id })
        .where(and(inArray(schema.files.id, parsed.fileIds), pendingFilesWhere(sessionId, revision.id))).returning({ id: schema.files.id });
      if (attached.length !== new Set(parsed.fileIds).size) throw conflict(revisionErrors.files, "revision_files_missing");
    }
    const [updated] = await tx.update(schema.taskRevisions).set({
      status: "submitted", responseMessageId: message.id, submittedAt: now, updatedAt: now,
    }).where(and(eq(schema.taskRevisions.id, revision.id), eq(schema.taskRevisions.status, "pending"))).returning();
    await touchConversation(tx, conv.id, now);
    return publicRevision(updated);
  });
  await cleanupSessionDrafts(sessionId);
  return result;
}

/** Revision screenshots remain private chat files and never alter the original submission. */
async function uploadRevisionFileImpl(sessionId: string, revisionId: string, file: { name: string; type: string; buffer: Buffer }) {
  if (!z.uuid().safeParse(revisionId).success) throw badRequest(revisionErrors.inactive, "revision_inactive");
  await db().transaction(async tx => { await lockVisitor(tx, sessionId); await requirePending(tx, sessionId, revisionId); });
  const valid = await validateFile({ name: file.name, declaredType: file.type, buffer: file.buffer }, {
    allowed: uploadConfig.screenshotTypes, maxBytes: uploadConfig.maxFileSizeBytes,
  });
  const storageKey = `${revisionPrefix(sessionId, revisionId)}${randomUUID()}.${valid.ext}`;
  try {
    await storage().put(storageKey, file.buffer, valid.mime);
    return await db().transaction(async tx => {
      await lockVisitor(tx, sessionId);
      await requirePending(tx, sessionId, revisionId);
      const [{ n }] = await tx.select({ n: count() }).from(schema.files).where(pendingFilesWhere(sessionId, revisionId));
      if (n >= uploadConfig.maxFilesPerSubmission) throw badRequest(content.errors.fileCount(uploadConfig.maxFilesPerSubmission), "file_count");
      const [row] = await tx.insert(schema.files).values({
        sessionId, purpose: "chat", uploadedBy: "visitor", storageKey,
        originalName: valid.displayName, mimeType: valid.mime, sizeBytes: valid.size,
      }).returning();
      return toPublicFile(row);
    });
  } catch (error) {
    await storage().delete(storageKey).catch(() => {});
    throw error;
  }
}

/** Retain rows on storage failure so the sweep can retry; terminal files are unreadable. */
async function purgeTerminalRevisionFilesImpl(limit = 30, sessionId?: string) {
  const files = await db().select({ id: schema.files.id, sessionId: schema.files.sessionId, revisionId: schema.taskRevisions.id })
    .from(schema.files)
    .innerJoin(schema.leads, eq(schema.leads.sessionId, schema.files.sessionId))
    .innerJoin(schema.taskRevisions, and(eq(schema.taskRevisions.leadId, schema.leads.id),
      sql`${schema.files.storageKey} like ('uploads/' || ${schema.leads.sessionId}::text || '/revisions/' || ${schema.taskRevisions.id}::text || '/%')`))
    .where(and(inArray(schema.taskRevisions.status, ["submitted", "cancelled"]), isNull(schema.files.messageId),
      isNull(schema.files.submissionId), sessionId ? eq(schema.files.sessionId, sessionId) : undefined))
    .limit(Math.max(1, Math.min(limit, 100)));
  let deleted = 0;
  for (const file of files) {
    try {
      const removed = await db().transaction(async tx => {
        await lockVisitor(tx, file.sessionId);
        const [revision] = await tx.select({ status: schema.taskRevisions.status }).from(schema.taskRevisions)
          .where(eq(schema.taskRevisions.id, file.revisionId));
        if (!revision || revision.status === "pending") return false;
        const [row] = await tx.select().from(schema.files).where(and(eq(schema.files.id, file.id), pendingFilesWhere(file.sessionId, file.revisionId)));
        if (!row) return false;
        // The lock prevents a draft from becoming attached while its object is removed.
        await storage().delete(row.storageKey);
        await tx.delete(schema.files).where(eq(schema.files.id, row.id));
        return true;
      });
      if (removed) deleted++;
    } catch { console.warn("task_revisions.cleanup_pending"); }
  }
  return { deleted, pending: files.length - deleted };
}

async function cleanupSessionDrafts(sessionId: string) {
  await purgeTerminalRevisionFilesImpl(30, sessionId).catch(() => console.warn("task_revisions.cleanup_pending"));
}

/** Drizzle errors contain SQL parameters, including private instructions and answers. */
function revisionOperation<A extends unknown[], R>(name: string, run: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try { return await run(...args); }
    catch (error) {
      unstable_rethrow(error);
      if (error instanceof AppError || error instanceof ZodError) throw error;
      console.warn(`task_revisions.${name}_failed`);
      throw new AppError(500, "revision_failed", "Nie udało się zapisać lub wczytać poprawy. Spróbuj ponownie.");
    }
  };
}

export const requestTaskRevision = revisionOperation("request", requestTaskRevisionImpl);
export const cancelTaskRevision = revisionOperation("cancel", cancelTaskRevisionImpl);
export const getLeadRevisions = revisionOperation("history", getLeadRevisionsImpl);
export const getVisitorRevision = revisionOperation("get", getVisitorRevisionImpl);
export const submitTaskRevision = revisionOperation("response", submitTaskRevisionImpl);
export const uploadRevisionFile = revisionOperation("upload", uploadRevisionFileImpl);
export const purgeTerminalRevisionFiles = revisionOperation("cleanup", purgeTerminalRevisionFilesImpl);
