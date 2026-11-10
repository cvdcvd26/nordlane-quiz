import "server-only";
import { and, asc, desc, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/db";
import { lockVisitor, type Transaction } from "@/server/session-lock";
import { candidateEmailConfigured, candidateSiteUrl, CandidateEmailError, sendCandidateEmail } from "@/server/brevo";
import { candidateEmailQueue } from "@/server/candidate-email-queue";
import { badRequest } from "@/server/errors";
import { buildCandidateEmailTemplate } from "@/server/candidate-email-templates";

export const CHAT_EMAIL_WAIT_MS = 30 * 60_000;
// New unread HR replies can notify again after half an hour. The sequence
// cursor still prevents reminders for messages covered by an earlier email.
export const CHAT_EMAIL_COOLDOWN_MS = 30 * 60_000;
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

async function unreadRange(tx: Transaction, sessionId: string, after: bigint, through?: bigint) {
  const fields = { sequence: schema.messages.sequence, createdAt: schema.messages.createdAt };
  const conditions = and(eq(schema.conversations.sessionId, sessionId), eq(schema.messages.sender, "admin"),
    isNull(schema.messages.deletedAt), gt(schema.messages.sequence, after),
    through === undefined ? undefined : lte(schema.messages.sequence, through));
  const [first] = await tx.select(fields).from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(conditions).orderBy(asc(schema.messages.sequence)).limit(1);
  if (!first) return null;
  const [last] = await tx.select(fields).from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
    .where(conditions).orderBy(desc(schema.messages.sequence)).limit(1);
  return { first, last };
}

/** A timed-out transport may already have delivered; cancellation cannot undo it. */
async function holdAttemptedChatCooldown(tx: Transaction, job: typeof j.$inferSelect, sessionId: string, now: Date) {
  if (job.throughSequence === null) return;
  const [attempted] = await tx.select({ status: schema.candidateEmailSends.status }).from(schema.candidateEmailSends)
    .where(eq(schema.candidateEmailSends.id, `candidate-${job.id}`));
  if (!attempted || attempted.status === "rejected") return;
  await stateFor(tx, sessionId);
  await tx.update(s).set({ lastNotifiedSequence: sql`greatest(${s.lastNotifiedSequence}, ${job.throughSequence})`,
    lastNotifiedAt: now }).where(eq(s.sessionId, sessionId));
}

/** Keep messages arriving during an attempted send in their own future group. */
async function ensureRemainingChatEmail(tx: Transaction, accountId: string, sessionId: string, now: Date) {
  const state = await stateFor(tx, sessionId);
  const after = state.lastReadSequence > state.lastNotifiedSequence ? state.lastReadSequence : state.lastNotifiedSequence;
  const range = await unreadRange(tx, sessionId, after);
  const pendingWhere = and(eq(j.accountId, accountId), eq(j.kind, "chat"), eq(j.status, "pending"));
  if (!range || await chatClosed(tx, sessionId)) {
    await tx.update(j).set({ status: "cancelled" }).where(pendingWhere);
    return null;
  }
  const dueAt = new Date(Math.max(range.first.createdAt.getTime() + CHAT_EMAIL_WAIT_MS,
    state.lastNotifiedAt ? state.lastNotifiedAt.getTime() + CHAT_EMAIL_COOLDOWN_MS : 0, now.getTime()));
  const [pending] = await tx.select().from(j).where(pendingWhere);
  if (pending) {
    if (pending.dueAt.getTime() !== dueAt.getTime()) {
      await tx.update(j).set({ dueAt, queuedAt: null }).where(eq(j.id, pending.id));
    }
    return pending.id;
  }
  const id = randomUUID();
  await tx.insert(j).values({ id, accountId, kind: "chat", dedupeKey: `chat-${id}`, dueAt });
  return id;
}

/** Called with the visitor lock inside the same transaction as a new or retried HR message. */
export async function recordAdminMessageEmail(tx: Transaction, sessionId: string, messageId: string, now = new Date(), messageEvent: "new" | "retry" = "new") {
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
  const [pending] = await tx.select().from(j)
    .where(and(eq(j.accountId, account.id), eq(j.kind, "chat"), eq(j.status, "pending")));
  if (pending) {
    // An unattempted group may still carry the former three-hour deadline.
    // Bring it forward for a new reply, but never postpone the first message
    // or override a retry/quota delay or an already attempted message range.
    if (messageEvent === "new" && pending.attempts === 0 && pending.throughSequence === null) {
      const [attempted] = await tx.select({ id: schema.candidateEmailSends.id }).from(schema.candidateEmailSends)
        .where(eq(schema.candidateEmailSends.id, `candidate-${pending.id}`));
      if (!attempted) {
        const range = await unreadRange(tx, sessionId,
          state.lastReadSequence > state.lastNotifiedSequence ? state.lastReadSequence : state.lastNotifiedSequence);
        if (range) {
          const dueAt = new Date(Math.max(range.first.createdAt.getTime() + CHAT_EMAIL_WAIT_MS,
            state.lastNotifiedAt ? state.lastNotifiedAt.getTime() + CHAT_EMAIL_COOLDOWN_MS : 0, now.getTime()));
          if (dueAt < pending.dueAt) {
            await tx.update(j).set({ dueAt, queuedAt: null }).where(eq(j.id, pending.id));
          }
        }
      }
    }
    return pending.id;
  }
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

export async function markCandidateMessagesRead(sessionId: string, sequence: string, now = new Date()) {
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
    if (!range) {
      const pendingWhere = and(eq(j.accountId, account.id), eq(j.kind, "chat"), eq(j.status, "pending"));
      const [pending] = await tx.select().from(j).where(pendingWhere);
      if (pending) await holdAttemptedChatCooldown(tx, pending, sessionId, now);
      await tx.update(j).set({ status: "cancelled" }).where(pendingWhere);
    }
  });
}

type Job = typeof j.$inferSelect;
type Claim = { outcome: "send"; job: Job; email: string; sessionId: string } |
  { outcome: "done"; nextJobId?: string | null } | { outcome: "busy" | "rescheduled" };

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
      if (account && job.kind === "chat") await holdAttemptedChatCooldown(tx, job, target.sessionId, now);
      await tx.update(j).set({ status: "cancelled", lockedAt: null }).where(eq(j.id, id));
      return { outcome: "done" };
    }
    let throughSequence = job.throughSequence;
    if (job.kind === "chat") {
      const [other] = await tx.select({ id: j.id }).from(j).where(and(eq(j.accountId, account.id),
        eq(j.kind, "chat"), eq(j.status, "sending"), ne(j.id, job.id)));
      if (other) return { outcome: "busy" };
      const [attempted] = await tx.select({ status: schema.candidateEmailSends.status }).from(schema.candidateEmailSends)
        .where(eq(schema.candidateEmailSends.id, `candidate-${job.id}`));
      // Once Brevo may have accepted this logical email, its message range is
      // immutable. Retrying with a wider range could mark newer messages as
      // notified even though provider idempotency returns the *old* send.
      // An accepted ledger entry only needs local finalization (sendCandidateEmail
      // returns without network). Every other retry still rechecks reading and
      // deletion inside its original range before attempting the transport.
      if (attempted?.status !== "accepted" || job.throughSequence === null) {
        const state = await stateFor(tx, target.sessionId);
        const range = await unreadRange(tx, target.sessionId,
          state.lastReadSequence > state.lastNotifiedSequence ? state.lastReadSequence : state.lastNotifiedSequence,
          attempted && job.throughSequence !== null ? job.throughSequence : undefined);
        if (!range) {
          await tx.update(j).set({ status: "cancelled", lockedAt: null }).where(eq(j.id, id));
          await holdAttemptedChatCooldown(tx, job, target.sessionId, now);
          const nextJobId = await ensureRemainingChatEmail(tx, account.id, target.sessionId, now);
          return { outcome: "done", nextJobId };
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
        if (!attempted || job.throughSequence === null) throughSequence = range.last.sequence;
      }
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
  if (claim.outcome === "done" && claim.nextJobId) await enqueueCandidateEmail(claim.nextJobId);
  if (claim.outcome !== "send") return claim.outcome;
  const { job, sessionId } = claim;
  const template = buildCandidateEmailTemplate({ kind: job.kind as "welcome" | "chat", site: candidateSiteUrl() });
  try {
    await sendCandidateEmail(job.kind as "welcome" | "chat", claim.email, template.subject, template.text, `candidate-${job.id}`, now, template.html);
  } catch (error) {
    const code = error instanceof CandidateEmailError ? error.code : "temporary";
    const retry = code === "temporary" || code === "quota";
    let remaining: string | null = null;
    await db().transaction(async tx => {
      await lockVisitor(tx, sessionId);
      if (retry && job.kind === "chat") {
        // A new group may have been created while the transport was in flight.
        // Merge its work into this retry; any messages beyond the frozen range
        // get a new group once this provider attempt is resolved.
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
        remaining = await ensureRemainingChatEmail(tx, job.accountId, sessionId, now);
      }
    });
    if (retry) { await enqueueCandidateEmail(id); return "rescheduled"; }
    if (remaining) await enqueueCandidateEmail(remaining);
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
      pending = await ensureRemainingChatEmail(tx, job.accountId, sessionId, now);
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
