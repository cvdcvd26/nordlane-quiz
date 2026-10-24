import { and, asc, count, desc, eq, gt, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { z, ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { REMINDER_PAGE_SIZE, reminderCreateSchema, reminderDeleteSchema, reminderListSchema, reminderUpdateSchema, type LeadReminder, type ReminderFilter } from "@/lib/reminders";
import { AppError, conflict, notFound } from "../errors";

const t = () => schema.leadReminders;
const idSchema = z.uuid();
type Row = typeof schema.leadReminders.$inferSelect;
function publicReminder(row: Row, name: string | null = null): LeadReminder {
  return { id: row.id, leadId: row.leadId, name, body: row.body, dueAt: row.dueAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null, revision: row.revision,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function requireLead(leadId: number) {
  if (!Number.isSafeInteger(leadId) || leadId <= 0) throw notFound();
  const [lead] = await db().select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.id, leadId));
  if (!lead) throw notFound();
}
function scoped(leadId: number, id: string) {
  if (!idSchema.safeParse(id).success) throw notFound();
  return and(eq(t().id, id), eq(t().leadId, leadId));
}
function filterWhere(filter: ReminderFilter, now: Date): SQL | undefined {
  if (filter === "done") return isNotNull(t().completedAt);
  if (filter === "due") return and(isNull(t().completedAt), lte(t().dueAt, now));
  if (filter === "upcoming") return and(isNull(t().completedAt), gt(t().dueAt, now));
}

async function listRemindersImpl(input: unknown, leadId?: number) {
  const { filter, offset } = reminderListSchema.parse(input);
  if (leadId !== undefined) await requireLead(leadId);
  const now = new Date();
  const scope = leadId !== undefined ? eq(t().leadId, leadId) : undefined;
  const [rows, totals] = await Promise.all([
    db().select({ reminder: t(), name: schema.visitorContacts.name }).from(t())
      .innerJoin(schema.leads, eq(schema.leads.id, t().leadId))
      .leftJoin(schema.visitorContacts, eq(schema.visitorContacts.sessionId, schema.leads.sessionId))
      .where(and(scope, filterWhere(filter, now)))
      .orderBy(filter === "done" ? desc(t().completedAt) : asc(t().dueAt), asc(t().id))
      .limit(REMINDER_PAGE_SIZE).offset(offset),
    db().select({
      all: count(),
      due: sql<number>`count(*) filter (where ${t().completedAt} is null and ${t().dueAt} <= ${now})`.mapWith(Number),
      upcoming: sql<number>`count(*) filter (where ${t().completedAt} is null and ${t().dueAt} > ${now})`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${t().completedAt} is not null)`.mapWith(Number),
    }).from(t()).where(scope),
  ]);
  const counts = totals[0];
  return { reminders: rows.map(row => publicReminder(row.reminder, row.name)), counts, total: counts[filter], offset, now: now.toISOString() };
}

async function createReminderImpl(leadId: number, adminId: string, input: unknown) {
  const parsed = reminderCreateSchema.parse(input);
  await requireLead(leadId);
  // Hold the parent row so a concurrent deletion cannot turn a valid create into a FK error.
  return db().transaction(async tx => {
    const [lead] = await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.id, leadId)).for("key share");
    if (!lead) throw notFound();
    const [row] = await tx.insert(t()).values({ leadId, createdBy: adminId, body: parsed.body, dueAt: new Date(parsed.dueAt) }).returning();
    return publicReminder(row);
  });
}

async function missingOrChanged(leadId: number, id: string): Promise<never> {
  const [row] = await db().select({ id: t().id }).from(t()).where(scoped(leadId, id));
  if (!row) throw notFound();
  throw conflict("This reminder changed. Reload before saving.", "reminder_changed");
}
async function updateReminderImpl(leadId: number, id: string, input: unknown) {
  const parsed = reminderUpdateSchema.parse(input);
  const now = new Date();
  const changes = parsed.action === "edit" ? { body: parsed.body, dueAt: new Date(parsed.dueAt) }
    : { completedAt: parsed.action === "complete" ? now : null };
  const [row] = await db().update(t()).set({ ...changes, updatedAt: now, revision: sql`${t().revision} + 1` })
    .where(and(scoped(leadId, id), eq(t().revision, parsed.revision))).returning();
  if (!row) return missingOrChanged(leadId, id);
  return publicReminder(row);
}
async function deleteReminderImpl(leadId: number, id: string, input: unknown) {
  const parsed = reminderDeleteSchema.parse(input);
  const [row] = await db().delete(t()).where(and(scoped(leadId, id), eq(t().revision, parsed.revision))).returning({ id: t().id });
  if (!row) return missingOrChanged(leadId, id);
  return { deleted: true };
}

/** Only deadlines crossed or overdue reminders changed in this poll window generate alerts. */
async function reminderActivityImpl(since: Date, now = new Date()) {
  const due = and(isNull(t().completedAt), lte(t().dueAt, now));
  const [rows, totals] = await Promise.all([
    db().select({ id: t().id, leadId: t().leadId, body: t().body, dueAt: t().dueAt, revision: t().revision })
      .from(t()).where(and(due, or(gt(t().dueAt, since), gt(t().updatedAt, since))))
      .orderBy(asc(t().dueAt), asc(t().id)).limit(10),
    db().select({ n: count() }).from(t()).where(due),
  ]);
  return { reminders: rows.map(row => ({ ...row, dueAt: row.dueAt.toISOString(), body: row.body.slice(0, 160) })), dueReminderCount: totals[0].n };
}

/** Drizzle's unexpected errors include SQL parameters containing private reminder text. */
function reminderOperation<A extends unknown[], R>(name: string, run: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try { return await run(...args); }
    catch (error) {
      unstable_rethrow(error);
      if (error instanceof AppError || error instanceof ZodError) throw error;
      console.warn(`reminders.${name}_failed`);
      throw new AppError(500, "reminder_failed", "Could not save or load reminders. Try again.");
    }
  };
}

export const listReminders = reminderOperation("list", listRemindersImpl);
export const createReminder = reminderOperation("create", createReminderImpl);
export const updateReminder = reminderOperation("update", updateReminderImpl);
export const deleteReminder = reminderOperation("delete", deleteReminderImpl);
export const reminderActivity = reminderOperation("activity", reminderActivityImpl);
