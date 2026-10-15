import { and, asc, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { badRequest, notFound } from "../errors";
import { LEAD_STATUSES, QUESTION_KEYS, content } from "@/config/content";
import { loadMessages, attachFiles, messageSchema } from "./chat";
import { toPublicFile } from "./uploads";
import { touchConversation } from "./conversation";
import { ensureConversation } from "./leads";

const listSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  status: z.enum(LEAD_STATUSES as [string, ...string[]]).optional(),
  sort: z.enum(["desc", "asc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});

export async function listLeads(input: Record<string, string | undefined>) {
  const p = listSchema.parse({ ...input, status: input.status || undefined, q: input.q || undefined });
  const L = schema.leads;
  // Explicit "leads".* references: inside subqueries Drizzle may render bare column names.
  const leadSession = sql.raw(`"leads"."session_id"`);
  const leadIdCol = sql.raw(`"leads"."id"`);
  // All answers, ordered by question key: e.g. "yes,no,yes".
  const answer = sql<string | null>`(select string_agg(qa.answer, ',' order by qa.question_key) from quiz_answers qa
    where qa.session_id = ${leadSession})`;

  const contactName = sql<string | null>`(select vc.name from visitor_contacts vc where vc.session_id = ${leadSession})`;
  const contactPhone = sql<string | null>`(select vc.phone from visitor_contacts vc where vc.session_id = ${leadSession})`;
  const submitted = sql<boolean>`exists (select 1 from task_submissions ts where ts.session_id = ${leadSession})`;

  // Phone search compares digits only, so "600 123", "+48600123" and "600-123" all match.
  const qDigits = p.q.replace(/\D/g, "");
  const phoneMatch =
    qDigits.length >= 3 ? sql`regexp_replace(vc.phone, '\D', '', 'g') like ${"%" + qDigits + "%"}` : sql`false`;

  const filters: SQL[] = [];
  if (p.status) filters.push(eq(L.status, p.status as (typeof LEAD_STATUSES)[number]));
  if (p.q) {
    const asId = /^#?\d+$/.test(p.q) ? Number(p.q.replace("#", "")) : null;
    const like = `%${p.q.replace(/[%_\\]/g, "\\$&")}%`;
    filters.push(
      or(
        asId !== null ? eq(L.id, asId) : undefined,
        sql`exists (select 1 from messages m join conversations c on c.id = m.conversation_id
          where c.session_id = ${leadSession} and m.body ilike ${like})`,
        sql`exists (select 1 from lead_notes n where n.lead_id = ${leadIdCol} and n.body ilike ${like})`,
        sql`exists (select 1 from task_submissions ts where ts.session_id = ${leadSession} and ts.review ilike ${like})`,
        sql`exists (select 1 from visitor_contacts vc where vc.session_id = ${leadSession}
          and (vc.name ilike ${like} or vc.telegram ilike ${like} or ${phoneMatch}))`,
      )!,
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db()
      .select({
        id: L.id,
        status: L.status,
        createdAt: L.createdAt,
        lastMessageAt: L.lastMessageAt,
        messageCount: L.messageCount,
        answer,
        contactName,
        contactPhone,
        submitted,
      })
      .from(L)
      .where(where)
      .orderBy(p.sort === "asc" ? asc(L.createdAt) : desc(L.createdAt), desc(L.id))
      .limit(p.pageSize)
      .offset((p.page - 1) * p.pageSize),
    db().select({ total: sql<number>`count(*)::int` }).from(L).where(where),
  ]);

  return {
    items: rows.map((r) => ({
      ...r,
      stage: leadStage(r.answer ? r.answer.split(",").length : 0, Boolean(r.submitted)),
      answered: r.answer ? r.answer.split(",").length : 0,
      createdAt: r.createdAt.toISOString(),
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    })),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

/**
 * Which of the four visitor screens the person is on: Kontakt → Pytania → Zadanie → Gotowe.
 * A lead exists only after the contact screen, so the earliest stage is "questions".
 */
export type LeadStage = "questions" | "task" | "submitted";
function leadStage(answered: number, submitted: boolean): LeadStage {
  if (submitted) return "submitted";
  return answered >= QUESTION_KEYS.length ? "task" : "questions";
}

async function findLead(leadId: number) {
  const [lead] = await db().select().from(schema.leads).where(eq(schema.leads.id, leadId)).limit(1);
  if (!lead) throw notFound(content.admin.lead.notFound);
  return lead;
}

export async function getLeadDetails(leadId: number) {
  const lead = await findLead(leadId);
  const [contact] = await db()
    .select({ name: schema.visitorContacts.name, phone: schema.visitorContacts.phone, telegram: schema.visitorContacts.telegram })
    .from(schema.visitorContacts)
    .where(eq(schema.visitorContacts.sessionId, lead.sessionId))
    .limit(1);
  const [answers, [submission], [conversation], notes] = await Promise.all([
    db().select().from(schema.quizAnswers).where(eq(schema.quizAnswers.sessionId, lead.sessionId)),
    db().select().from(schema.taskSubmissions).where(eq(schema.taskSubmissions.sessionId, lead.sessionId)).limit(1),
    db().select().from(schema.conversations).where(eq(schema.conversations.sessionId, lead.sessionId)).limit(1),
    db().select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, leadId)).orderBy(desc(schema.leadNotes.createdAt)),
  ]);
  const submissionFiles = submission
    ? await db().select().from(schema.files).where(eq(schema.files.submissionId, submission.id)).orderBy(asc(schema.files.createdAt))
    : [];
  const [scheduled] = submission
    ? await db().select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.submissionId, submission.id)).limit(1)
    : [];

  return {
    lead: {
      id: lead.id,
      status: lead.status,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
      messageCount: lead.messageCount,
      lastMessageAt: lead.lastMessageAt?.toISOString() ?? null,
      stage: leadStage(answers.length, Boolean(submission)),
      answered: answers.length,
    },
    contact: contact ?? null,
    answers: content.quiz.questions.map((q) => {
      const a = answers.find((x) => x.questionKey === q.key);
      return {
        question: q.text,
        answer: a ? (content.admin.answers[a.answer] ?? a.answer) : "—",
        value: a?.answer ?? null,
        updatedAt: a?.updatedAt.toISOString() ?? null,
      };
    }),
    submission: submission
      ? {
          id: submission.id,
          submittedAt: submission.submittedAt.toISOString(),
          review: submission.review,
          files: submissionFiles.map(toPublicFile),
          autoMessage: scheduled
            ? {
                status: scheduled.status,
                scheduledFor: scheduled.scheduledFor.toISOString(),
                sentAt: scheduled.sentAt?.toISOString() ?? null,
                attempts: scheduled.attempts,
                lastError: scheduled.lastError,
              }
            : null,
        }
      : null,
    messages: conversation ? await loadMessages(conversation.id) : [],
    notes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() })),
  };
}

export async function updateLeadStatus(leadId: number, input: unknown) {
  const { status } = z.object({ status: z.enum(LEAD_STATUSES as [string, ...string[]]) }).parse(input);
  await findLead(leadId);
  await db()
    .update(schema.leads)
    .set({ status: status as (typeof LEAD_STATUSES)[number], updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId));
}

export async function addLeadNote(leadId: number, input: unknown) {
  const { body } = z.object({ body: z.string().trim().min(1, content.admin.lead.noteEmpty).max(5000) }).parse(input);
  await findLead(leadId);
  const [note] = await db().insert(schema.leadNotes).values({ leadId, body }).returning();
  await db().update(schema.leads).set({ updatedAt: new Date() }).where(eq(schema.leads.id, leadId));
  return { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() };
}

/** Admin reply: goes into the same conversation the visitor sees. Idempotent by clientMessageId. */
export async function postAdminMessage(leadId: number, input: unknown) {
  const { clientMessageId, body, fileIds } = messageSchema.parse(input);
  const text = body.trim();
  if (!text && fileIds.length === 0) throw badRequest(content.errors.messageEmpty);
  const lead = await findLead(leadId);
  // A lead may exist before the task is sent; the conversation is created on the first reply.
  const conv = await ensureConversation(db(), lead.sessionId);

  const now = new Date();
  await db().transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.messages)
      .values({ conversationId: conv.id, sender: "admin", body: text, clientMessageId, createdAt: now })
      .onConflictDoNothing()
      .returning();
    if (!inserted) return;
    await attachFiles(tx, { fileIds, sessionId: lead.sessionId, messageId: inserted.id, uploadedBy: "admin" });
    await touchConversation(tx, conv.id, now);
  });
  return loadMessages(conv.id);
}

export async function getLeadSessionId(leadId: number) {
  return (await findLead(leadId)).sessionId;
}


const reviewsSchema = z.object({
  q: z.string().trim().max(200).optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(100).optional().default(20),
});

/** Reviews written with the task, newest first, with the employee and lead they belong to. */
export async function listReviews(input: Record<string, string | undefined>) {
  const p = reviewsSchema.parse({ ...input, q: input.q || undefined });
  const like = `%${p.q.replace(/[%_\\]/g, "\\$&")}%`;
  const where = p.q
    ? sql`ts.review is not null and (ts.review ilike ${like} or vc.name ilike ${like})`
    : sql`ts.review is not null`;
  const from = sql`from task_submissions ts
    join leads l on l.session_id = ts.session_id
    left join visitor_contacts vc on vc.session_id = ts.session_id
    where ${where}`;
  type Row = { id: string; review: string; submitted_at: string | Date; lead_id: number | string; status: string; name: string | null; phone: string | null };
  // execute() returns { rows } on every driver used here (neon, node-postgres, PGlite).
  const run = async <T>(q: SQL) => ((await db().execute(q)) as unknown as { rows: T[] }).rows;
  const [rows, [{ total }]] = await Promise.all([
    run<Row>(sql`select ts.id, ts.review, ts.submitted_at, l.id as lead_id, l.status, vc.name, vc.phone ${from}
      order by ts.submitted_at desc, ts.id
      limit ${p.pageSize} offset ${(p.page - 1) * p.pageSize}`),
    run<{ total: number }>(sql`select count(*)::int as total ${from}`),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      review: r.review,
      submittedAt: new Date(r.submitted_at).toISOString(),
      leadId: Number(r.lead_id),
      status: r.status as (typeof LEAD_STATUSES)[number],
      name: r.name,
      phone: r.phone,
    })),
    total: Number(total),
    page: p.page,
    pageSize: p.pageSize,
  };
}
