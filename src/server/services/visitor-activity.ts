import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db, schema, type Db } from "@/db";
import { content } from "@/config/content";
import { analyticsConfig } from "@/config/analytics";
import type { CookieConsent } from "@/lib/cookie-consent";
import { AppError, conflict, unauthorized } from "../errors";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const emptyAttribution = {
  consentAll: false, utmSource: null, utmMedium: null, utmCampaign: null,
  utmContent: null, utmTerm: null, referrerHost: null,
};

const tag = z.string().trim().max(analyticsConfig.maxTagLength).refine(value => !/[\u0000-\u001f\u007f]/.test(value)).nullable().optional();
const host = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i).transform(value => value.toLowerCase()).nullable().optional();
const attributionSchema = z.object({
  utmSource: tag, utmMedium: tag, utmCampaign: tag, utmContent: tag, utmTerm: tag, referrerHost: host,
}).strict();
const activitySchema = z.object({ visible: z.literal(true), taskViewed: z.boolean().optional().default(false) }).strict();

async function lockSession(tx: Transaction, sessionId: string) {
  const [session] = await tx.select({ id: schema.visitorSessions.id }).from(schema.visitorSessions)
    .where(eq(schema.visitorSessions.id, sessionId)).for("update");
  if (!session) throw unauthorized();
}

/** The same row lock orders withdrawal and capture, including requests already in flight. */
async function applyConsent(tx: Transaction, sessionId: string, consent: CookieConsent | null, input?: unknown) {
  const [existing] = await tx.select().from(schema.visitorAttribution).where(eq(schema.visitorAttribution.sessionId, sessionId));
  if (!consent && !existing?.consentAll) return;
  const revision = new Date(consent?.updatedAt ?? Date.now());
  if (existing?.consentUpdatedAt && existing.consentUpdatedAt > revision) return;
  if (existing && !existing.consentAll && existing.consentUpdatedAt?.getTime() === revision.getTime() && consent?.preferences) return;
  if (!consent?.preferences) {
    if (existing?.consentAll || existing?.consentUpdatedAt?.getTime() !== revision.getTime()) {
      // Keep the last decision even without source data, so a stale consented request cannot restore it.
      await tx.insert(schema.visitorAttribution).values({ sessionId, ...emptyAttribution, consentUpdatedAt: revision })
        .onConflictDoUpdate({ target: schema.visitorAttribution.sessionId, set: { ...emptyAttribution, consentUpdatedAt: revision, updatedAt: new Date() } });
    }
    return;
  }
  if (existing?.consentAll) {
    if (existing.consentUpdatedAt?.getTime() !== revision.getTime())
      await tx.update(schema.visitorAttribution).set({ consentUpdatedAt: revision, updatedAt: new Date() }).where(eq(schema.visitorAttribution.sessionId, sessionId));
    return;
  }
  if (input === undefined) return;
  const values = attributionSchema.parse(input);
  await tx.insert(schema.visitorAttribution).values({
    sessionId, consentAll: true, consentUpdatedAt: revision,
    utmSource: values.utmSource || null, utmMedium: values.utmMedium || null, utmCampaign: values.utmCampaign || null,
    utmContent: values.utmContent || null, utmTerm: values.utmTerm || null, referrerHost: values.referrerHost || null,
  }).onConflictDoUpdate({ target: schema.visitorAttribution.sessionId, set: {
    consentAll: true, consentUpdatedAt: revision, updatedAt: new Date(),
    utmSource: values.utmSource || null, utmMedium: values.utmMedium || null, utmCampaign: values.utmCampaign || null,
    utmContent: values.utmContent || null, utmTerm: values.utmTerm || null, referrerHost: values.referrerHost || null,
  } });
}

export async function syncVisitorAttribution(sessionId: string, input: unknown, consent: CookieConsent | null) {
  try {
    return await db().transaction(async tx => {
      await lockSession(tx, sessionId);
      await applyConsent(tx, sessionId, consent, input);
    });
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    // Driver errors can contain campaign values as SQL parameters. Never pass them to route logging.
    throw new AppError(500, "attribution_unavailable", "Source data could not be saved.");
  }
}

export async function recordVisitorActivity(sessionId: string, input: unknown, consent: CookieConsent | null, now = new Date()) {
  const { taskViewed } = activitySchema.parse(input);
  return db().transaction(async tx => {
    await lockSession(tx, sessionId);
    await applyConsent(tx, sessionId, consent);
    await tx.update(schema.visitorSessions).set({ lastSeenAt: now }).where(and(
      eq(schema.visitorSessions.id, sessionId),
      sql`${schema.visitorSessions.lastSeenAt} <= ${new Date(now.getTime() - analyticsConfig.heartbeatIntervalMs)}`,
    ));
    if (taskViewed) {
      const [[contact], answers] = await Promise.all([
        tx.select({ id: schema.visitorContacts.id }).from(schema.visitorContacts).where(eq(schema.visitorContacts.sessionId, sessionId)).limit(1),
        tx.select({ key: schema.quizAnswers.questionKey }).from(schema.quizAnswers).where(and(
          eq(schema.quizAnswers.sessionId, sessionId),
          or(...content.quiz.questions.map(question => and(eq(schema.quizAnswers.questionKey, question.key), inArray(schema.quizAnswers.answer, question.options.map(option => option.value))))),
        )),
      ]);
      if (!contact || new Set(answers.map(answer => answer.key)).size !== content.quiz.questions.length)
        throw conflict("Save a contact and all quiz answers before viewing the task.", "task_prerequisites");
      await tx.insert(schema.visitorAttribution).values({ sessionId, taskViewedAt: now }).onConflictDoUpdate({
        target: schema.visitorAttribution.sessionId,
        set: { taskViewedAt: sql`coalesce(${schema.visitorAttribution.taskViewedAt}, ${now})`, updatedAt: now },
      });
    }
    return { ok: true };
  });
}
