import { z } from "zod";
import { lockVisitor } from "../session-lock";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, count, notLike } from "drizzle-orm";
import { db, schema } from "@/db";
import { storage } from "../storage";
import { validateFile } from "../file-validation";
import { badRequest, conflict, notFound } from "../errors";
import { uploadConfig } from "@/config/settings";
import { content } from "@/config/content";
import { assertVisitorChatOpen } from "./candidate-outcome";
import { revisionFilePrefix, revisionIdForFileKey } from "@/config/task-revisions";
import { requireVisitorChatAccess } from "./visitor-chat-access";

export type PublicFile = { id: string; name: string; mime: string; size: number; url: string };

export const toPublicFile = (f: typeof schema.files.$inferSelect): PublicFile => ({
  id: f.id,
  name: f.originalName,
  mime: f.mimeType,
  size: f.sizeBytes,
  url: `/api/files/${f.id}`,
});

type UploadInput = {
  sessionId: string;
  purpose: "submission" | "chat";
  uploadedBy: "visitor" | "admin";
  file: { name: string; type: string; buffer: Buffer };
};

export async function uploadFile({ sessionId, purpose, uploadedBy, file }: UploadInput): Promise<PublicFile> {
  const allowed = uploadedBy === "admin" ? uploadConfig.adminAttachmentTypes
    : purpose === "chat" ? uploadConfig.chatAttachmentTypes : uploadConfig.screenshotTypes;
  const v = await validateFile(
    { name: file.name, declaredType: file.type, buffer: file.buffer },
    { allowed, maxBytes: uploadConfig.maxFileSizeBytes },
  );

  const visitorChatUpload = purpose === "chat" && uploadedBy === "visitor";
  if (visitorChatUpload) {
    // Reject a closed chat before writing an object to storage. Do not keep the
    // database lock across the external upload; the final transaction checks again.
    await db().transaction(async (tx) => {
      await lockVisitor(tx, sessionId);
      await requireVisitorChatAccess(tx, sessionId);
      await assertVisitorChatOpen(tx, sessionId);
    });
  }

  // Storage key never contains user input.
  const storageKey = `uploads/${sessionId}/${randomUUID()}.${v.ext}`;
  await storage().put(storageKey, file.buffer, v.mime);

  try {
    return await db().transaction(async (tx) => {
      await lockVisitor(tx, sessionId);
      if (visitorChatUpload) {
        await requireVisitorChatAccess(tx, sessionId);
        await assertVisitorChatOpen(tx, sessionId);
      }
      if (purpose === "submission") {
        const [sub] = await tx
          .select({ id: schema.taskSubmissions.id })
          .from(schema.taskSubmissions)
          .where(eq(schema.taskSubmissions.sessionId, sessionId))
          .limit(1);
        if (sub) throw conflict(content.errors.alreadySubmitted, "already_submitted");

        const [{ n }] = await tx
          .select({ n: count() })
          .from(schema.files)
          .where(
            and(
              eq(schema.files.sessionId, sessionId),
              eq(schema.files.purpose, "submission"),
              isNull(schema.files.submissionId),
            ),
          );
        if (n >= uploadConfig.maxFilesPerSubmission)
          throw badRequest(content.errors.fileCount(uploadConfig.maxFilesPerSubmission), "file_count");
      } else {
        const [{ n }] = await tx.select({ n: count() }).from(schema.files).where(and(
          eq(schema.files.sessionId, sessionId), eq(schema.files.purpose, "chat"),
          eq(schema.files.uploadedBy, uploadedBy), isNull(schema.files.messageId),
          notLike(schema.files.storageKey, `${revisionFilePrefix(sessionId)}%`)));
        if (n >= uploadConfig.maxPendingChatFiles)
          throw badRequest(content.errors.fileCount(uploadConfig.maxPendingChatFiles), "file_count");
      }

      const [row] = await tx
        .insert(schema.files)
        .values({
          sessionId,
          purpose,
          uploadedBy,
          storageKey,
          originalName: v.displayName,
          mimeType: v.mime,
          sizeBytes: v.size,
        })
        .returning();
      return toPublicFile(row);
    });
  } catch (err) {
    await storage().delete(storageKey).catch(() => {});
    throw err;
  }
}

/** Removes a file the visitor uploaded but hasn't sent yet. */
export async function deletePendingFile(sessionId: string, fileId: string, owner: "visitor" | "admin" = "visitor") {
  if (!z.uuid().safeParse(fileId).success) throw notFound();
  const removed = await db().transaction(async (tx) => {
    await lockVisitor(tx, sessionId);
    const [f] = await tx.select().from(schema.files)
      .where(and(eq(schema.files.id, fileId), eq(schema.files.sessionId, sessionId))).limit(1);
    if (!f || f.uploadedBy !== owner) throw notFound();
    if (f.submissionId || f.messageId) throw conflict(content.errors.fileAlreadySent, "file_attached");
    await tx.delete(schema.files).where(eq(schema.files.id, f.id));
    return f;
  });
  await storage().delete(removed.storageKey).catch(() => {});
}

export async function listPendingSubmissionFiles(sessionId: string) {
  const rows = await db()
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.sessionId, sessionId),
        eq(schema.files.purpose, "submission"),
        isNull(schema.files.submissionId),
      ),
    )
    .orderBy(schema.files.createdAt);
  return rows.map(toPublicFile);
}

/**
 * Who may read a file:
 * - an admin: any file;
 * - a visitor: only files of their own session that they uploaded or that were sent to them in a message.
 * - cancelled or unused terminal revision drafts: inaccessible while storage cleanup is retried.
 */
export async function getReadableFile(fileId: string, viewer: { admin: true } | { sessionId: string }) {
  if (!z.uuid().safeParse(fileId).success) return null;
  const [f] = await db().select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
  if (!f) return null;
  const revisionId = revisionIdForFileKey(f.sessionId, f.storageKey);
  if (revisionId) {
    const [revision] = await db().select({ status: schema.taskRevisions.status, responseMessageId: schema.taskRevisions.responseMessageId })
      .from(schema.taskRevisions).where(eq(schema.taskRevisions.id, revisionId));
    if (!revision || (f.messageId ? revision.status !== "submitted" || revision.responseMessageId !== f.messageId : revision.status !== "pending")) return null;
  }
  if (f.messageId) {
    const [message] = await db().select({ deletedAt: schema.messages.deletedAt }).from(schema.messages).where(eq(schema.messages.id, f.messageId));
    if (!message || message.deletedAt) return null;
  }
  if ("admin" in viewer) return f;
  if (f.sessionId !== viewer.sessionId) return null;
  if (f.uploadedBy === "admin" && !f.messageId) return null;
  return f;
}
