import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LeadStatus } from "@/config/content";
import type { LeadClosure, LeadQualification, LeadResultState } from "@/config/lead-results";
import { AppError, notFound } from "../errors";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { lockVisitor, type Transaction } from "../session-lock";

type ResultRow = typeof schema.leadResults.$inferSelect;
type LeadRow = typeof schema.leads.$inferSelect;

/** The only business status is leads.status. Past assessment survives non-assessment closures. */
export function resultForStatus(status: LeadStatus, previousQualification?: string): { qualification: LeadQualification; closure: LeadClosure } {
  const retained = previousQualification === "suitable" ? "suitable" : "unreviewed";
  switch (status) {
    case "signal_working": return { qualification: "suitable", closure: "signal_working" };
    case "suitable": return { qualification: "suitable", closure: "open" };
    case "rejected": return { qualification: "unsuitable", closure: "not_suitable" };
    case "data_received": return { qualification: retained, closure: "data_received" };
    case "candidate_declined": return { qualification: retained, closure: "candidate_declined" };
    case "no_contact": return { qualification: retained, closure: "no_contact" };
    case "completed": return { qualification: retained, closure: "completed" };
    default: return { qualification: "unreviewed", closure: "open" };
  }
}
export function effectiveLeadResult(lead: Pick<LeadRow, "status" | "statusChangedAt">, row?: ResultRow): LeadResultState {
  const derived = resultForStatus(lead.status, row?.qualification);
  const closedAt = derived.closure === "open" || derived.closure === "data_received" ? null
    : row?.closure === derived.closure && row.closedAt ? row.closedAt : lead.statusChangedAt;
  return { status: lead.status, ...derived, reason: row?.reason as LeadResultState["reason"] ?? null, comment: row?.comment ?? "",
    responsibleAdminId: row?.responsibleAdminId ?? null, updatedById: row?.updatedBy ?? null, version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null, closedAt: closedAt?.toISOString() ?? null };
}

/** Fixed query aliases only: used once in every result report/detail, including drilldowns. */
export const resultQualificationSql = sql`case when l.status in ('signal_working', 'suitable') then 'suitable'
  when l.status = 'rejected' then 'unsuitable'
  when l.status in ('data_received', 'candidate_declined', 'no_contact', 'completed') and r.qualification = 'suitable' then 'suitable'
  else 'unreviewed' end`;
export const resultClosureSql = sql`case when l.status = 'rejected' then 'not_suitable'
  when l.status in ('signal_working', 'data_received', 'candidate_declined', 'no_contact', 'completed') then l.status::text
  else 'open' end`;
export const resultClosedAtSql = sql`case when (${resultClosureSql}) in ('open', 'data_received') then null
  when r.closure = (${resultClosureSql}) and r.closed_at is not null then r.closed_at else l.status_changed_at end`;

/** Caller holds visitor then lead row locks; status and private metadata share the same revision. */
export async function saveResultSnapshot(tx: Transaction, leadId: number, previous: LeadResultState, next: LeadResultState, actorId: string | null, now: Date) {
  const values = { qualification: next.qualification, closure: next.closure, reason: next.reason, comment: next.comment,
    responsibleAdminId: next.responsibleAdminId, updatedBy: actorId, version: previous.version + 1, updatedAt: now,
    closedAt: next.closedAt ? new Date(next.closedAt) : null };
  await tx.insert(schema.leadResults).values({ leadId, ...values })
    .onConflictDoUpdate({ target: schema.leadResults.leadId, set: values });
  const saved: LeadResultState = { ...next, version: values.version, updatedById: actorId, updatedAt: now.toISOString() };
  await tx.insert(schema.leadResultHistory).values({ leadId, previous, next: saved, actorId, version: values.version, createdAt: now });
}

async function changeLeadStatusImpl(leadId: number, status: LeadStatus, actorId: string | null = null, now = new Date()) {
  const [initial] = await db().select({ sessionId: schema.leads.sessionId }).from(schema.leads).where(eq(schema.leads.id, leadId));
  if (!initial) throw notFound();
  await db().transaction(async tx => {
    await lockVisitor(tx, initial.sessionId);
    const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, leadId)).for("update");
    if (!lead) throw notFound();
    if (lead.status === status) return;
    const [current] = await tx.select().from(schema.leadResults).where(eq(schema.leadResults.leadId, leadId));
    const previous = effectiveLeadResult(lead, current);
    const derived = resultForStatus(status, previous.qualification);
    const closedAt = ["open", "data_received"].includes(derived.closure) ? null
      : previous.closure === derived.closure && previous.closedAt ? previous.closedAt : now.toISOString();
    await tx.update(schema.leads).set({ status, statusChangedAt: now, updatedAt: now,
      ...(status !== "rejected" ? { candidateResultBody: null, candidateResultPublishedAt: null } : {}),
    }).where(eq(schema.leads.id, leadId));
    await saveResultSnapshot(tx, leadId, previous, { ...previous, status, ...derived, closedAt }, actorId, now);
  });
}

/** Status audit includes private snapshots. Never let Drizzle SQL parameters reach the generic route logger. */
export async function changeLeadStatus(leadId: number, status: LeadStatus, actorId: string | null = null, now = new Date()) {
  try { await changeLeadStatusImpl(leadId, status, actorId, now); }
  catch (error) {
    unstable_rethrow(error);
    if (error instanceof AppError || error instanceof ZodError) throw error;
    console.warn("lead_status.update_failed");
    throw new AppError(500, "lead_status_failed", "Could not update the lead status. Try again.");
  }
}
