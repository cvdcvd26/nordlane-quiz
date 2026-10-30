import { lockVisitor } from "../session-lock";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { badRequest } from "../errors";
import { getSettings } from "../settings";
import { queue } from "../queue";
import { log } from "../log";
import { content } from "@/config/content";
import { reviewConfig, uploadConfig } from "@/config/settings";
import { allAnswered, getAnswers } from "./quiz";
import { getContact } from "./contact";
import { ensureConversation, ensureLead } from "./leads";
import { touchConversation } from "./conversation";
import type { ChatMessage } from "./chat";

export const submitSchema = z.object({
  idempotencyKey: z.string().min(16).max(100),
  fileIds: z.array(z.string().uuid()).min(1, content.errors.filesRequired).max(uploadConfig.maxFilesPerSubmission),
  review: z
    .string({ error: content.errors.reviewRequired })
    .trim()
    .min(reviewConfig.minLength, content.errors.reviewRequired)
    .max(reviewConfig.maxLength, content.errors.reviewTooLong),
});

export type SubmitResult = {
  submissionId: string;
  submittedAt: string;
  duplicate: boolean;
  acknowledgement: ChatMessage | null;
};

function toAcknowledgement(message: typeof schema.messages.$inferSelect): ChatMessage {
  return {
    id: message.id,
    sequence: message.sequence.toString(),
    sender: message.sender,
    body: message.body,
    bodyRich: message.bodyRich,
    createdAt: message.createdAt.toISOString(),
    clientMessageId: message.clientMessageId,
    changeRevision: message.changeRevision,
    files: [],
  };
}

/**
 * Saves the task and its informational acknowledgement in the same transaction.
 * Success is returned only after both are durable; no timer or queue is involved.
 * Repeated calls (double click, retry after a timeout) return the same submission.
 */
export async function submitTask(sessionId: string, input: unknown): Promise<SubmitResult> {
  const { idempotencyKey, fileIds, review } = submitSchema.parse(input);

  const existing = await findSubmission(sessionId);
  if (existing) {
    await recoverPendingEnqueue(existing.submissionId);
    return { ...existing, duplicate: true };
  }

  if (!(await getContact(sessionId))) throw badRequest(content.errors.contactRequired, "contact_required");
  if (!allAnswered(await getAnswers(sessionId))) throw badRequest(content.errors.answerRequired, "answer_required");

  const settings = await getSettings();

  const result = await db().transaction(async (tx) => {
    await lockVisitor(tx, sessionId);
    const [submission] = await tx
      .insert(schema.taskSubmissions)
      .values({ sessionId, idempotencyKey, review })
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

    let acknowledgement: ChatMessage | null = null;
    if (settings.autoMessageEnabled) {
      const [scheduled] = await tx
        .insert(schema.scheduledMessages)
        .values({
          submissionId: submission.id,
          conversationId: conversation.id,
          scheduledFor: submission.submittedAt,
        })
        .returning();
      const [message] = await tx.insert(schema.messages).values({
        conversationId: conversation.id,
        sender: "system",
        body: settings.autoMessageText,
        clientMessageId: `scheduled:${scheduled.id}`,
        createdAt: submission.submittedAt,
      }).returning();
      await tx.update(schema.scheduledMessages).set({
        status: "sent",
        attempts: 1,
        sentAt: submission.submittedAt,
        messageId: message.id,
        lockedAt: null,
        lastError: null,
      }).where(eq(schema.scheduledMessages.id, scheduled.id));
      await touchConversation(tx, conversation.id, submission.submittedAt);
      acknowledgement = toAcknowledgement(message);
    }
    return { submission, acknowledgement };
  });

  if (!result) {
    const again = await findSubmission(sessionId);
    if (again) {
      await recoverPendingEnqueue(again.submissionId);
      return { ...again, duplicate: true };
    }
    throw badRequest(content.errors.generic);
  }

  return {
    submissionId: result.submission.id,
    submittedAt: result.submission.submittedAt.toISOString(),
    duplicate: false,
    acknowledgement: result.acknowledgement,
  };
}

/**
 * Compatibility for pending jobs created before acknowledgements became immediate.
 * New task submissions never publish to this queue.
 */
export async function enqueue(scheduledId: string, at: Date) {
  const t = schema.scheduledMessages;
  const eligible = and(eq(t.id, scheduledId), inArray(t.status, ["pending", "failed"]), isNull(t.queueMessageId));
  try {
    // A retry may race a completed delivery, cancellation, or another enqueue.
    const [pending] = await db().select({ id: t.id }).from(t).where(eligible).limit(1);
    if (!pending || !(await getSettings()).autoMessageEnabled) return;
    const queueMessageId = await queue().scheduleDelivery(scheduledId, at);
    // Local fallback-only queues return null. That is not an accepted job and
    // must not erase a previous enqueue failure from the stored diagnostics.
    if (!queueMessageId) return;
    await db()
      .update(t)
      .set({ queueMessageId, lastError: null })
      .where(eligible);
    log.info("scheduler", "scheduled message accepted by queue", { scheduledId, queueMessageId, scheduledFor: at.toISOString() });
  } catch (err) {
    log.error("scheduler", "failed to enqueue scheduled message", err, { scheduledId });
    await db()
      .update(t)
      .set({ lastError: `enqueue failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500) })
      .where(eligible);
  }
}

/** Repair the commit → external queue gap without changing the original job or delay. */
async function recoverPendingEnqueue(submissionId: string) {
  try {
    const t = schema.scheduledMessages;
    const [pending] = await db().select({ id: t.id, scheduledFor: t.scheduledFor }).from(t)
      .where(and(eq(t.submissionId, submissionId), inArray(t.status, ["pending", "failed"]), isNull(t.queueMessageId)))
      .limit(1);
    if (pending) await enqueue(pending.id, pending.scheduledFor);
  } catch {
    // A saved submission stays successful even if the optional repair cannot
    // reach the database/queue. The regular delivery safety net still applies.
    log.warn("scheduler", "could not recover submission enqueue", { submissionId });
  }
}

async function findSubmission(sessionId: string) {
  const [s] = await db()
    .select()
    .from(schema.taskSubmissions)
    .where(eq(schema.taskSubmissions.sessionId, sessionId))
    .limit(1);
  if (!s) return null;
  const [message] = await db().select({ message: schema.messages }).from(schema.scheduledMessages)
    .innerJoin(schema.messages, eq(schema.messages.id, schema.scheduledMessages.messageId))
    .where(and(
      eq(schema.scheduledMessages.submissionId, s.id),
      eq(schema.scheduledMessages.status, "sent"),
      isNull(schema.messages.deletedAt),
    )).limit(1);
  return {
    submissionId: s.id,
    submittedAt: s.submittedAt.toISOString(),
    acknowledgement: message ? toAcknowledgement(message.message) : null,
  };
}
