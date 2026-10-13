import { randomUUID } from "node:crypto";
import { and, eq, isNull, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { storage } from "../storage";
import { validateFile } from "../file-validation";
import { badRequest, conflict, notFound } from "../errors";
import { uploadConfig } from "@/config/settings";
import { content } from "@/config/content";

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
  const allowed = uploadedBy === "admin" ? uploadConfig.adminAttachmentTypes : uploadConfig.screenshotTypes;
  const v = await validateFile(
    { name: file.name, declaredType: file.type, buffer: file.buffer },
    { allowed, maxBytes: uploadConfig.maxFileSizeBytes },
  );

  if (purpose === "submission") {
    const [sub] = await db()
      .select({ id: schema.taskSubmissions.id })
      .from(schema.taskSubmissions)
      .where(eq(schema.taskSubmissions.sessionId, sessionId))
      .limit(1);
    if (sub) throw conflict(content.errors.alreadySubmitted, "already_submitted");

    const [{ n }] = await db()
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
  }

  // Storage key never contains user input.
  const storageKey = `uploads/${sessionId}/${randomUUID()}.${v.ext}`;
  await storage().put(storageKey, file.buffer, v.mime);

  try {
    const [row] = await db()
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
  } catch (err) {
    await storage().delete(storageKey).catch(() => {});
    throw err;
  }
}

/** Removes a file the visitor uploaded but hasn't sent yet. */
export async function deletePendingFile(sessionId: string, fileId: string) {
  const [f] = await db()
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, fileId), eq(schema.files.sessionId, sessionId)))
    .limit(1);
  if (!f || f.uploadedBy !== "visitor") throw notFound();
  if (f.submissionId || f.messageId) throw conflict(content.errors.fileAlreadySent, "file_attached");
  await db().delete(schema.files).where(eq(schema.files.id, f.id));
  await storage().delete(f.storageKey).catch(() => {});
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
 */
export async function getReadableFile(fileId: string, viewer: { admin: true } | { sessionId: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const [f] = await db().select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
  if (!f) return null;
  if ("admin" in viewer) return f;
  if (f.sessionId !== viewer.sessionId) return null;
  if (f.uploadedBy === "admin" && !f.messageId) return null;
  return f;
}
