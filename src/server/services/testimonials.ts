import { lockVisitor } from "../session-lock";
import { ensureConversation } from "./leads";
import { touchConversation } from "./conversation";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { badRequest, conflict, notFound } from "../errors";
import { content } from "@/config/content";
import { testimonialConfig } from "@/config/settings";
import { log } from "../log";

export type TestimonialStatus = (typeof schema.testimonialStatus.enumValues)[number];
const STATUSES = schema.testimonialStatus.enumValues;

const e = content.errors;

const submitSchema = z.object({
  name: z.string({ error: e.nameRequired }).trim().min(1, e.nameRequired).max(testimonialConfig.maxNameLength, e.nameTooLong),
  rating: z.coerce.number({ error: e.ratingRequired }).int().min(1, e.ratingRequired).max(5, e.ratingRequired),
  body: z
    .string({ error: e.testimonialTooShort })
    .trim()
    .min(testimonialConfig.minLength, e.testimonialTooShort)
    .max(testimonialConfig.maxLength, e.testimonialTooLong),
});

const adminFields = submitSchema.extend({
  city: z.string().trim().max(100, "Miasto jest za długie (maks. 100 znaków).")
    .nullable().optional().transform((value) => value || null),
  age: z.number({ error: "Wiek musi być liczbą całkowitą od 1 do 120." })
    .int("Wiek musi być liczbą całkowitą od 1 do 120.")
    .min(1, "Wiek musi być liczbą całkowitą od 1 do 120.")
    .max(120, "Wiek musi być liczbą całkowitą od 1 do 120.").nullable().optional(),
  status: z.enum(STATUSES),
});
const createSchema = adminFields.extend({ status: z.enum(STATUSES).default("pending") }).strict();
const updateSchema = adminFields.partial().strict().refine((data) => Object.keys(data).length > 0, {
  message: "Podaj dane opinii do zmiany.",
});

async function leadOfSession(sessionId: string) {
  const [lead] = await db().select().from(schema.leads).where(eq(schema.leads.sessionId, sessionId)).limit(1);
  return lead ?? null;
}

const publicView = (t: typeof schema.testimonials.$inferSelect) => ({
  id: t.id,
  name: t.name,
  city: t.city,
  age: t.age,
  rating: t.rating,
  body: t.body,
  status: t.status,
  createdAt: t.createdAt.toISOString(),
  publishedAt: t.publishedAt?.toISOString() ?? null,
});

/* ---------- Visitor ---------- */

/** Whether the review form is unlocked for this visitor, and what they already sent. */
export async function getVisitorTestimonial(sessionId: string) {
  const lead = await leadOfSession(sessionId);
  const [t] = await db().select().from(schema.testimonials).where(eq(schema.testimonials.sessionId, sessionId)).limit(1);
  return {
    requested: Boolean(lead?.testimonialRequestedAt),
    submitted: t ? { name: t.name, rating: t.rating, body: t.body, status: t.status } : null,
  };
}

/** One review per visitor, only after the manager asked for it. Goes to moderation. */
export async function submitTestimonial(sessionId: string, input: unknown) {
  const data = submitSchema.parse(input);
  const lead = await leadOfSession(sessionId);
  if (!lead?.testimonialRequestedAt) throw badRequest(e.testimonialNotRequested, "testimonial_not_requested");
  const [row] = await db()
    .insert(schema.testimonials)
    .values({ sessionId, ...data })
    .onConflictDoNothing()
    .returning();
  if (!row) throw conflict(e.testimonialAlreadySent, "testimonial_exists");
  log.info("testimonials", "testimonial submitted", { leadId: lead.id, rating: data.rating });
  return publicView(row);
}

/* ---------- Public ---------- */

/** Published reviews for the first screen, newest first. */
export async function listPublishedTestimonials(limit = testimonialConfig.publicLimit) {
  const rows = await db()
    .select()
    .from(schema.testimonials)
    .where(eq(schema.testimonials.status, "published"))
    .orderBy(desc(schema.testimonials.publishedAt))
    .limit(limit);
  return rows.map((t) => ({ id: t.id, name: t.name, city: t.city, age: t.age, rating: t.rating, body: t.body }));
}

/* ---------- Admin ---------- */

/** A manually entered review has no visitor session or lead. */
export async function createTestimonial(input: unknown) {
  const data = createSchema.parse(input);
  const [row] = await db().insert(schema.testimonials).values({
    ...data,
    sessionId: null,
    city: data.city ?? null,
    age: data.age ?? null,
    publishedAt: data.status === "published" ? new Date() : null,
  }).returning();
  return publicView(row);
}

/**
 * Unlocks the review form for the lead's visitor and tells them in the chat
 * (the message also plays the visitor's notification sound). Idempotent.
 */
export async function requestTestimonial(leadId: number) {
  const [lead] = await db().select().from(schema.leads).where(eq(schema.leads.id, leadId)).limit(1);
  if (!lead) throw notFound(content.admin.lead.notFound);
  return db().transaction(async (tx) => {
    await lockVisitor(tx, lead.sessionId);
    const [current] = await tx.select().from(schema.leads).where(eq(schema.leads.id, leadId));
    if (current.testimonialRequestedAt)
      return { requestedAt: current.testimonialRequestedAt.toISOString(), alreadyRequested: true };
    const now = new Date();
    const conv = await ensureConversation(tx, lead.sessionId);
    await tx.insert(schema.messages).values({
      conversationId: conv.id, sender: "admin", body: content.testimonials.requestMessage,
      clientMessageId: `testimonial-request:${leadId}`, createdAt: now,
    }).onConflictDoNothing();
    await tx.update(schema.leads).set({ testimonialRequestedAt: now, updatedAt: now }).where(eq(schema.leads.id, leadId));
    await touchConversation(tx, conv.id, now);
    return { requestedAt: now.toISOString(), alreadyRequested: false };
  });
}

export async function getLeadTestimonial(leadId: number) {
  const [lead] = await db().select().from(schema.leads).where(eq(schema.leads.id, leadId)).limit(1);
  if (!lead) return null;
  const [t] = await db().select().from(schema.testimonials).where(eq(schema.testimonials.sessionId, lead.sessionId)).limit(1);
  return { requestedAt: lead.testimonialRequestedAt?.toISOString() ?? null, testimonial: t ? publicView(t) : null };
}

const listSchema = z.object({
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});

/** Moderation queue with counts per status. */
export async function listTestimonials(input: Record<string, string | undefined>) {
  const p = listSchema.parse({ ...input, status: input.status || undefined });
  const where = p.status ? eq(schema.testimonials.status, p.status) : undefined;
  const [rows, counts] = await Promise.all([
    db()
      .select({ t: schema.testimonials, leadId: schema.leads.id, leadStatus: schema.leads.status })
      .from(schema.testimonials)
      .leftJoin(schema.leads, eq(schema.leads.sessionId, schema.testimonials.sessionId))
      .where(where)
      .orderBy(desc(schema.testimonials.createdAt))
      .limit(p.pageSize)
      .offset((p.page - 1) * p.pageSize),
    db()
      .select({ status: schema.testimonials.status, n: sql<number>`count(*)::int` })
      .from(schema.testimonials)
      .groupBy(schema.testimonials.status),
  ]);
  const count = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TestimonialStatus, number>;
  counts.forEach((c) => (count[c.status] = Number(c.n)));
  return {
    items: rows.map((r) => ({ ...publicView(r.t), leadId: r.leadId, leadStatus: r.leadStatus })),
    counts: count,
    total: p.status ? count[p.status] : STATUSES.reduce((a, s) => a + count[s], 0),
    page: p.page,
    pageSize: p.pageSize,
  };
}

/** Partial edits also support the existing publish/hide moderation controls. */
export async function updateTestimonial(id: string, input: unknown) {
  const data = updateSchema.parse(input);
  const now = new Date();
  const [row] = await db()
    .update(schema.testimonials)
    .set({
      ...data,
      updatedAt: now,
      ...(data.status === undefined ? {} : {
        publishedAt: data.status === "published" ? sql`coalesce(${schema.testimonials.publishedAt}, ${now})` : null,
      }),
    })
    .where(eq(schema.testimonials.id, id))
    .returning();
  if (!row) throw notFound(content.admin.testimonials.notFound);
  return publicView(row);
}

export async function setTestimonialStatus(id: string, input: unknown) {
  const data = z.object({ status: z.enum(STATUSES) }).parse(input);
  return updateTestimonial(id, data);
}

export async function deleteTestimonial(id: string) {
  const res = await db().delete(schema.testimonials).where(and(eq(schema.testimonials.id, id))).returning({ id: schema.testimonials.id });
  if (!res.length) throw notFound(content.admin.testimonials.notFound);
  return { deleted: 1 };
}
