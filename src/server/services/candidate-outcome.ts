import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { candidateOutcomeConfig, type CandidateOutcome } from "@/config/candidate-outcome";
import { AppError } from "../errors";
import type { Transaction } from "../session-lock";

type ResultFields = Pick<typeof schema.leads.$inferSelect, "status" | "candidateResultBody" | "candidateResultPublishedAt">;

export function toCandidateOutcome(lead: ResultFields | undefined): CandidateOutcome | null {
  if (lead?.status !== "rejected" || !lead.candidateResultBody || !lead.candidateResultPublishedAt) return null;
  return {
    status: "rejected",
    title: candidateOutcomeConfig.title,
    body: lead.candidateResultBody,
    publishedAt: lead.candidateResultPublishedAt.toISOString(),
  };
}

/** Only explicitly published results leave the administrative API. */
export async function getSessionOutcome(sessionId: string) {
  const [lead] = await db().select({
    status: schema.leads.status,
    candidateResultBody: schema.leads.candidateResultBody,
    candidateResultPublishedAt: schema.leads.candidateResultPublishedAt,
  }).from(schema.leads).where(eq(schema.leads.sessionId, sessionId)).limit(1);
  return toCandidateOutcome(lead);
}

/** The caller holds lockVisitor, which also orders publication and retraction. */
export async function assertVisitorChatOpen(tx: Transaction, sessionId: string) {
  const [lead] = await tx.select({
    status: schema.leads.status,
    candidateResultBody: schema.leads.candidateResultBody,
    candidateResultPublishedAt: schema.leads.candidateResultPublishedAt,
  }).from(schema.leads).where(eq(schema.leads.sessionId, sessionId)).limit(1);
  if (toCandidateOutcome(lead)) {
    throw new AppError(403, "candidate_chat_closed", "Czat jest zamknięty po opublikowaniu wyniku zgłoszenia.");
  }
}
