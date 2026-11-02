import "server-only";
import { and, asc, desc, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/db";
import { lockVisitor, type Transaction } from "@/server/session-lock";
import { candidateEmailConfigured, candidateSiteUrl, CandidateEmailError, sendCandidateEmail } from "@/server/brevo";
import { candidateEmailQueue } from "@/server/candidate-email-queue";
import { badRequest } from "@/server/errors";

export const CHAT_EMAIL_WAIT_MS = 30 * 60_000;
export const CHAT_EMAIL_COOLDOWN_MS = 3 * 60 * 60_000;
const CLAIM_MS = 2 * 60_000;
const j = schema.candidateEmailJobs;
const s = schema.candidateEmailState;

async function accountFor(tx: Transaction, sessionId: string) {
  const [account] = await tx.select().from(schema.candidateAccounts).where(eq(schema.candidateAccounts.sessionId, sessionId));
  return account;
}

async function chatClosed(tx: Transaction, sessionId: string) {
  const [lead] = await tx.select({ publishedAt: schema.leads.candidateResultPublishedAt })
    .from(schema.leads).where(eq(schema.leads.sessionId, sessionId));
  // An internal rejection alone does not close the candidate's chat.
  return lead?.publishedAt != null;
}

async function stateFor(tx: Transaction, sessionId: string) {
  await tx.insert(s).values({ sessionId }).onConflictDoNothing();
  const [state] = await tx.select().from(s).where(eq(s.sessionId, sessionId));
  return state;
}

async function unreadRange(tx: Transaction, sessionId: string, after: bigint) {
  const fields = { sequence: schema.messages.sequence, createdAt: schema.messages.createdAt };
  const conditions = and(eq(schema.conversations.sessionId, sessionId), eq(schema.messages.sender, "admin"),
    isNull(schema.messages.deletedAt), gt(schema.messages.sequence, after));
  const [first] = await tx.select(fields).from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(conditions).orderBy(asc(schema.messages.sequence)).limit(1);
  if (!first) return null;
  const [last] = await tx.select(fields).from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(conditions).orderBy(desc(schema.messages.sequence)).limit(1);
  return { first, last };
}

/** Called with the visitor lock inside the same transaction as a new HR message. */
export async function recordAdminMessageEmail(tx: Transaction, sessionId: string, messageId: string, now = new Date()) {
  if (!candidateEmailConfigured()) return null;
  const account = await accountFor(tx, sessionId);
  if (!account || await chatClosed(tx, sessionId)) return null;
  const [message] = await tx.select({ sequence: schema.messages.sequence, createdAt: schema.messages.createdAt })
    .from(schema.messages).innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(and(eq(schema.messages.id, messageId), eq(schema.conversations.sessionId, sessionId),
      eq(schema.messages.sender, "admin"), isNull(schema.messages.deletedAt)));
  if (!message) return null;
  const state = await stateFor(tx, sessionId);
  if (message.sequence <= state.lastReadSequence || message.sequence <= state.lastNotifiedSequence) return null;
  const [pending] = await tx.select({ id: j.id }).from(j)
    .where(and(eq(j.accountId, account.id), eq(j.kind, "chat"), eq(j.status, "pending")));
  if (pending) return pending.id; // Existing first-message deadline never slides.
  const dueAt = new Date(Math.max(message.createdAt.getTime() + CHAT_EMAIL_WAIT_MS,
    state.lastNotifiedAt ? state.lastNotifiedAt.getTime() + CHAT_EMAIL_COOLDOWN_MS : 0, now.getTime()));
  const id = randomUUID();
  await tx.insert(j).values({ id, accountId: account.id, kind: "chat", dedupeKey: `chat-${id}`, dueAt });
  return id;
}

/** Called atomically with creation of the first verified account. */
export async function recordWelcomeEmail(tx: Transaction, sessionId: string) {
  if (!candidateEmailConfigured()) return null;
  const account = await accountFor(tx, sessionId);
  if (!account) return null;
  const [row] = await tx.insert(j).values({ accountId: account.id, kind: "welcome", dedupeKey: `welcome-${account.id}`, dueAt: new Date() })
    .onConflictDoNothing().returning({ id: j.id });
  if (row) return row.id;
  const [existing] = await tx.select({ id: j.id }).from(j).where(and(eq(j.dedupeKey, `welcome-${account.id}`), eq(j.status, "pending")));
  return existing?.id ?? null;
}

export async function queueWelcome(sessionId: string) {
  if (!candidateEmailConfigured()) return;
  const id = await db().transaction(async tx => {
    await lockVisitor(tx, sessionId);
    return recordWelcomeEmail(tx, sessionId);
  });
  if (id) await enqueueCandidateEmail(id);
}

/** Awaited after the caller's transaction commits. Retries do not duplicate queue tasks. */
export async function enqueueCandidateEmail(id: string) {
  if (!candidateEmailConfigured()) return;
  const [job] = await db().select().from(j).where(eq(j.id, id));
  if (!job || job.status !== "pending" || job.queuedAt) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await candidateEmailQueue().schedule(id, job.dueAt);
      await db().update(j).set({ queuedAt: new Date() }).where(and(eq(j.id, id), eq(j.dueAt, job.dueAt), eq(j.status, "pending")));
      return;
    } catch { /* The outbox is retained and enqueue is retried below. */ }
  }
  // Preserve the outbox row for recovery; never include a provider payload in logs.
  await db().update(j).set({ lastError: "queue_unavailable" }).where(eq(j.id, id));
  throw new Error("candidate_email_queue_unavailable");
}

export async function markCandidateMessagesRead(sessionId: string, sequence: string) {
  if (!candidateEmailConfigured()) return;
  if (!/^[1-9]\d{0,18}$/.test(sequence) || BigInt(sequence) > BigInt("9223372036854775807")) throw badRequest("Nieprawidłowa wiadomość.");
  await db().transaction(async tx => {
    await lockVisitor(tx, sessionId);
    const account = await accountFor(tx, sessionId);
    if (!account) return;
    // Keep ownership/sender validation, but allow a deleted HR message: it may
    // have been visible when the client captured this cursor before deletion.
    const [message] = await tx.select({ sequence: schema.messages.sequence }).from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(and(eq(schema.conversations.sessionId, sessionId), eq(schema.messages.sender, "admin"),
        eq(schema.messages.sequence, BigInt(sequence))));
    if (!message) throw badRequest("Nieprawidłowa wiadomość.");
    const state = await stateFor(tx, sessionId);
    const cursor = message.sequence > state.lastReadSequence ? message.sequence : state.lastReadSequence;
    await tx.update(s).set({ lastReadSequence: cursor }).where(eq(s.sessionId, sessionId));
    const range = await unreadRange(tx, sessionId, cursor > state.lastNotifiedSequence ? cursor : state.lastNotifiedSequence);
    if (!range) await tx.update(j).set({ status: "cancelled" })
      .where(and(eq(j.accountId, account.id), eq(j.kind, "chat"), eq(j.status, "pending")));
  });
}

type Job = typeof j.$inferSelect;
type Claim = { outcome: "send"; job: Job; email: string; sessionId: string } |
  { outcome: "done" | "busy" | "rescheduled" };

async function claimEmail(id: string, now: Date): Promise<Claim> {
  const [target] = await db().select({ sessionId: schema.candidateAccounts.sessionId }).from(j)
    .innerJoin(schema.candidateAccounts, eq(schema.candidateAccounts.id, j.accountId)).where(eq(j.id, id));
  if (!target) return { outcome: "done" };
  return db().transaction(async tx => {
    await lockVisitor(tx, target.sessionId);
    const [job] = await tx.select().from(j).where(eq(j.id, id)).for("update");
    if (!job || !["pending", "sending"].includes(job.status)) return { outcome: "done" };
    if (job.status === "sending" && job.lockedAt && now.getTime() - job.lockedAt.getTime() < CLAIM_MS) return { outcome: "busy" };
    // A premature callback must be retried, not acknowledged/re-enqueued using
    // the same provider deduplication key (which could discard the replacement).
    if (job.dueAt > now) return { outcome: "busy" };
    const account = await accountFor(tx, target.sessionId);
    if (!account || (job.kind === "chat" && await chatClosed(tx, target.sessionId))) {
      await tx.update(j).set({ status: "cancelled", lockedAt: null }).where(eq(j.id, id));
      return { outcome: "done" };
    }
    let throughSequence = job.throughSequence;
    if (job.kind === "chat") {
      const [other] = await tx.select({ id: j.id }).from(j).where(and(eq(j.accountId, account.id),
        eq(j.kind, "chat"), eq(j.status, "sending"), ne(j.id, job.id)));
      if (other) return { outcome: "busy" };
      const state = await stateFor(tx, target.sessionId);
      const range = await unreadRange(tx, target.sessionId, state.lastReadSequence > state.lastNotifiedSequence ? state.lastReadSequence : state.lastNotifiedSequence);
      if (!range) {
        await tx.update(j).set({ status: "cancelled", lockedAt: null }).where(eq(j.id, id));
        return { outcome: "done" };
      }
      const due = Math.max(range.first.createdAt.getTime() + CHAT_EMAIL_WAIT_MS,
        state.lastNotifiedAt ? state.lastNotifiedAt.getTime() + CHAT_EMAIL_COOLDOWN_MS : 0);
      if (due > now.getTime()) {
        // A stale sending job may have a newer pending sibling. Merge that
        // group before returning this job to pending (one pending row/account).
        await tx.update(j).set({ status: "cancelled" }).where(and(eq(j.accountId, account.id),
          eq(j.kind, "chat"), eq(j.status, "pending"), ne(j.id, job.id)));
        await tx.update(j).set({ dueAt: new Date(due), status: "pending", lockedAt: null, queuedAt: null }).where(eq(j.id, id));
        return { outcome: "rescheduled" };
      }
      throughSequence = range.last.sequence;
    }
    const [claimed] = await tx.update(j).set({ status: "sending", throughSequence, lockedAt: now, attempts: job.attempts + 1 })
      .where(eq(j.id, id)).returning();
    return { outcome: "send", job: claimed, email: account.email, sessionId: target.sessionId };
  });
}

export async function deliverCandidateEmail(id: string, now = new Date()): Promise<"sent" | "done" | "busy" | "rescheduled" | "disabled"> {
  if (!candidateEmailConfigured()) return "disabled";
  const claim = await claimEmail(id, now);
  if (claim.outcome === "rescheduled") { await enqueueCandidateEmail(id); return "rescheduled"; }
  if (claim.outcome !== "send") return claim.outcome;
  const { job, sessionId } = claim;
  const site = candidateSiteUrl();
  const title = job.kind === "welcome" ? "AlleyBiz — Twoje konto jest gotowe" : "AlleyBiz — czekają na Ciebie nowe wiadomości";
  const text = job.kind === "welcome"
    ? `Witaj w AlleyBiz!\n\nTwój adres e-mail został potwierdzony. Aktualna strona Twojego zgłoszenia:\n${site}\n\nAby wrócić do zgłoszenia, otwórz stronę, wybierz „Moje zgłoszenie” i wpisz ten adres e-mail. Na nowym urządzeniu potwierdź wejście jednorazowym kodem otrzymanym pocztą. W zapisanej sesji zgłoszenie otworzy się automatycznie.\n\nW swoim zgłoszeniu znajdziesz zadanie, status i rozmowę z HR.\n\nZespół AlleyBiz`
    : `W Twoim czacie AlleyBiz czekają nowe, nieprzeczytane wiadomości od HR.\n\nOtwórz swoje zgłoszenie:\n${site}\n\nJeśli pojawi się ekran logowania, wybierz „Moje zgłoszenie” i użyj tego adresu e-mail.\n\nPowiadomienia o wiadomościach łączymy i wysyłamy nie częściej niż raz na 3 godziny.\n\nZespół AlleyBiz`;
  try {
    await sendCandidateEmail(job.kind as "welcome" | "chat", claim.email, title, text, `candidate-${job.id}`, now);
  } catch (error) {
    const code = error instanceof CandidateEmailError ? error.code : "temporary";
    const retry = code === "temporary" || code === "quota";
    await db().transaction(async tx => {
      await lockVisitor(tx, sessionId);
      if (retry && job.kind === "chat") {
        // A new group may have been created while the transport was in flight.
        // Merge its work into this retry; delivery re-reads all unnotified messages.
        await tx.update(j).set({ status: "cancelled" }).where(and(eq(j.accountId, job.accountId), eq(j.kind, "chat"), eq(j.status, "pending"), ne(j.id, job.id)));
      }
      await tx.update(j).set({ status: retry ? "pending" : code === "uncertain" ? "uncertain" : "failed", lockedAt: null,
        lastError: code, queuedAt: null, dueAt: new Date(now.getTime() + (code === "quota" ? 60 * 60_000 : 60_000)) }).where(eq(j.id, id));
      if (code === "uncertain" && job.kind === "chat" && job.throughSequence !== null) {
        // Brevo might have accepted an earlier attempt. Do not let a fresh job
        // immediately send the same range again once the provider's key expires.
        await stateFor(tx, sessionId);
        await tx.update(s).set({ lastNotifiedSequence: sql`greatest(${s.lastNotifiedSequence}, ${job.throughSequence})`, lastNotifiedAt: now })
          .where(eq(s.sessionId, sessionId));
      }
    });
    if (retry) { await enqueueCandidateEmail(id); return "rescheduled"; }
    return "done";
  }
  let pending: string | null = null;
  await db().transaction(async tx => {
    await lockVisitor(tx, sessionId);
    await tx.update(j).set({ status: "sent", sentAt: now, lockedAt: null, lastError: null }).where(eq(j.id, id));
    if (job.kind === "chat" && job.throughSequence !== null) {
      await stateFor(tx, sessionId);
      await tx.update(s).set({ lastNotifiedSequence: sql`greatest(${s.lastNotifiedSequence}, ${job.throughSequence})`, lastNotifiedAt: now })
        .where(eq(s.sessionId, sessionId));
      const [next] = await tx.update(j).set({ dueAt: sql`greatest(${j.dueAt}, ${new Date(now.getTime() + CHAT_EMAIL_COOLDOWN_MS)})`, queuedAt: null })
        .where(and(eq(j.accountId, job.accountId), eq(j.kind, "chat"), eq(j.status, "pending"))).returning({ id: j.id });
      pending = next?.id ?? null;
    }
  });
  if (pending) await enqueueCandidateEmail(pending);
  return "sent";
}

/** Safety net only; the durable queue is the primary 30-minute scheduler. */
export async function recoverCandidateEmails(limit = 50) {
  if (!candidateEmailConfigured()) return { recovered: 0, failed: 0 };
  const now = new Date();
  const jobs = await db().select({ id: j.id, status: j.status, dueAt: j.dueAt }).from(j)
    .where(or(and(eq(j.status, "pending"), or(isNull(j.queuedAt), lte(j.dueAt, now))),
      and(eq(j.status, "sending"), lte(j.lockedAt, new Date(now.getTime() - CLAIM_MS)))))
    .orderBy(asc(j.dueAt)).limit(Math.min(Math.max(limit, 1), 100));
  let recovered = 0, failed = 0;
  for (const job of jobs) {
    try {
      if (job.dueAt <= now) await deliverCandidateEmail(job.id, now);
      else await enqueueCandidateEmail(job.id);
      recovered++;
    } catch { failed++; }
  }
  return { recovered, failed };
}
