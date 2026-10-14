import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { badRequest } from "../errors";
import { getSettings, pickDelayMs } from "../settings";
import { queue } from "../queue";
import { log } from "../log";
import { content } from "@/config/content";
import { uploadConfig } from "@/config/settings";
import { allAnswered, getAnswers } from "./quiz";
import { getContact } from "./contact";
import { ensureConversation, ensureLead } from "./leads";

export const submitSchema = z.object({
  idempotencyKey: z.string().min(16).max(100),
  fileIds: z.array(z.string().uuid()).min(1, content.errors.filesRequired).max(uploadConfig.maxFilesPerSubmission),
});

export type SubmitResult = { submissionId: string; submittedAt: string; duplicate: boolean };

/**
 * Saves the task atomically (submission + files + conversation + scheduled message),
 * then hands the delayed message to the external queue.
 * Repeated calls (double click, retry after a timeout) return the same submission.
 */
export async function submitTask(sessionId: string, input: unknown): Promise<SubmitResult> {
  const { idempotencyKey, fileIds } = submitSchema.parse(input);

  const existing = await findSubmission(sessionId);
  if (existing) return { ...existing, duplicate: true };

  if (!(await getContact(sessionId))) throw badRequest(content.errors.contactRequired, "contact_required");
  if (!allAnswered(await getAnswers(sessionId))) throw badRequest(content.errors.answerRequired, "answer_required");

  const settings = await getSettings();

  const result = await db().transaction(async (tx) => {
    const [submission] = await tx
      .insert(schema.taskSubmissions)
      .values({ sessionId, idempotencyKey })
      .onConflictDoNothing()
      .returning();
    if (!submission) return null; // a concurrent request won the race

    const attached = await tx
      .update(schema.files)
      .set({ submissionId: submission.id })
      .where(
        and(
          inArray(schema.files.id, fileIds),
          eq(schema.files.sessionId, sessionId),
          eq(schema.files.purpose, "submission"),
          isNull(schema.files.submissionId),
        ),
      )
      .returning({ id: schema.files.id });
    if (attached.length !== new Set(fileIds).size) {
      // Rolls back the whole transaction: nothing is considered submitted.
      throw badRequest(content.errors.filesMissing, "files_missing");
    }

    await ensureLead(tx, sessionId);
    const conversation = await ensureConversation(tx, sessionId);
    await tx.update(schema.leads).set({ updatedAt: new Date() }).where(eq(schema.leads.sessionId, sessionId));

    let scheduled: typeof schema.scheduledMessages.$inferSelect | null = null;
    if (settings.autoMessageEnabled) {
      [scheduled] = await tx
        .insert(schema.scheduledMessages)
        .values({
          submissionId: submission.id,
          conversationId: conversation.id,
          scheduledFor: new Date(submission.submittedAt.getTime() + pickDelayMs(settings)),
        })
        .returning();
    }
    return { submission, scheduled };
  });

  if (!result) {
    const again = await findSubmission(sessionId);
    if (again) return { ...again, duplicate: true };
    throw badRequest(content.errors.generic);
  }

  if (result.scheduled) await enqueue(result.scheduled.id, result.scheduled.scheduledFor);

  return {
    submissionId: result.submission.id,
    submittedAt: result.submission.submittedAt.toISOString(),
    duplicate: false,
  };
}

/**
 * The scheduled message is already safely stored. If the queue is temporarily unavailable,
 * it stays `pending` and the backup sweep delivers it when due.
 */
export async function enqueue(scheduledId: string, at: Date) {
  try {
    const queueMessageId = await queue().scheduleDelivery(scheduledId, at);
    await db()
      .update(schema.scheduledMessages)
      .set({ queueMessageId, lastError: null })
      .where(eq(schema.scheduledMessages.id, scheduledId));
  } catch (err) {
    log.error("scheduler", "failed to enqueue scheduled message", err, { scheduledId });
    await db()
      .update(schema.scheduledMessages)
      .set({ lastError: `enqueue failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500) })
      .where(eq(schema.scheduledMessages.id, scheduledId));
  }
}

async function findSubmission(sessionId: string) {
  const [s] = await db()
    .select()
    .from(schema.taskSubmissions)
    .where(eq(schema.taskSubmissions.sessionId, sessionId))
    .limit(1);
  return s ? { submissionId: s.id, submittedAt: s.submittedAt.toISOString() } : null;
}
