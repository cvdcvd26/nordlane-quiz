import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { badRequest } from "../errors";
import { content, QUESTION_KEYS } from "@/config/content";
import { listPendingSubmissionFiles, toPublicFile } from "./uploads";
import { getContact } from "./contact";

export type Answers = Record<string, string>;

export async function saveAnswer(sessionId: string, questionKey: string, answer: string) {
  const question = content.quiz.questions.find((q) => q.key === questionKey);
  if (!question) throw badRequest(content.errors.unknownQuestion);
  if (!question.options.some((o) => o.value === answer)) throw badRequest(content.errors.answerRequired);
  const now = new Date();
  await db()
    .insert(schema.quizAnswers)
    .values({ sessionId, questionKey, answer })
    .onConflictDoUpdate({
      target: [schema.quizAnswers.sessionId, schema.quizAnswers.questionKey],
      set: { answer, updatedAt: now },
    });
}

/** Answers to the current questions only (keys removed from the config are ignored). */
export async function getAnswers(sessionId: string): Promise<Answers> {
  const rows = await db()
    .select({ key: schema.quizAnswers.questionKey, answer: schema.quizAnswers.answer })
    .from(schema.quizAnswers)
    .where(eq(schema.quizAnswers.sessionId, sessionId));
  return Object.fromEntries(rows.filter((r) => QUESTION_KEYS.includes(r.key)).map((r) => [r.key, r.answer]));
}

export const allAnswered = (answers: Answers) => QUESTION_KEYS.every((k) => Boolean(answers[k]));

/** Everything the visitor UI needs to restore its state after a reload or a later visit. */
export async function getVisitorState(sessionId: string) {
  const [answers, contact] = await Promise.all([getAnswers(sessionId), getContact(sessionId)]);
  const [submission] = await db()
    .select()
    .from(schema.taskSubmissions)
    .where(eq(schema.taskSubmissions.sessionId, sessionId))
    .limit(1);

  if (!submission) {
    return { answers, contact, submission: null, files: await listPendingSubmissionFiles(sessionId) };
  }
  const files = await db().select().from(schema.files).where(eq(schema.files.submissionId, submission.id));
  return {
    answers,
    contact,
    submission: { id: submission.id, submittedAt: submission.submittedAt.toISOString() },
    files: files.map(toPublicFile),
  };
}
