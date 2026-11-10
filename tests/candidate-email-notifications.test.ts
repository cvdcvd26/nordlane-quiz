import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema } from "@/db";
import { setupTestEnv, newSession } from "./helpers";
import { candidateEmailConfigured, CandidateEmailError, sendCandidateEmail, sendCandidateCode, setCandidateEmailTransport } from "@/server/brevo";
import { setCandidateEmailQueue } from "@/server/candidate-email-queue";
import { deliverCandidateEmail, enqueueCandidateEmail, markCandidateMessagesRead, recordAdminMessageEmail,
  recordWelcomeEmail, recoverCandidateEmails } from "@/server/services/candidate-email-notifications";
import { postAdminMessage } from "@/server/services/admin";
import { lockVisitor } from "@/server/session-lock";

type Env = Awaited<ReturnType<typeof setupTestEnv>>;
let env: Env;
let sessionId: string;
let conversationId: string;
const start = new Date("2026-11-01T12:00:00Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
const sent: { email: string; subject: string; text: string; html?: string; id: string }[] = [];
const scheduled: { id: string; at: Date }[] = [];

async function hr(minutes: number, body = "Confidential test body") {
  return env.db.transaction(async tx => {
    await lockVisitor(tx, sessionId);
    const [message] = await tx.insert(schema.messages).values({ conversationId, sender: "admin", body,
      clientMessageId: randomUUID(), createdAt: at(minutes) }).returning();
    const jobId = await recordAdminMessageEmail(tx, sessionId, message.id, at(minutes));
    return { message, jobId: jobId! };
  });
}
async function job(id: string) { return (await env.db.select().from(schema.candidateEmailJobs).where(eq(schema.candidateEmailJobs.id, id)))[0]; }

beforeEach(async () => {
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "true");
  vi.stubEnv("BREVO_API_KEY", "test-private-api-key");
  vi.stubEnv("BREVO_SENDER_EMAIL", "notifications@example.com");
  vi.stubEnv("APP_URL", "https://example.com");
  vi.stubEnv("CANDIDATE_EMAIL_SECRET", "a-test-secret-with-more-than-32-characters");
  sent.length = 0; scheduled.length = 0;
  env = await setupTestEnv();
  sessionId = await newSession(env.db);
  await env.db.insert(schema.candidateAccounts).values({ sessionId, email: "candidate@example.com" });
  [ { id: conversationId } ] = await env.db.insert(schema.conversations).values({ sessionId }).returning();
  setCandidateEmailTransport(async p => { sent.push(p); return `provider-${sent.length}`; });
  setCandidateEmailQueue({ async schedule(id, time) { scheduled.push({ id, at: time }); } });
});

afterEach(async () => {
  setCandidateEmailTransport(null); setCandidateEmailQueue(null);
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await env.client.close();
});

describe("grouped candidate email outbox", () => {
  it("20 HR messages in 15 minutes share the first 30-minute deadline and one email", async () => {
    const first = await hr(0);
    for (let n = 1; n < 20; n++) expect((await hr(n * 15 / 20)).jobId).toBe(first.jobId);
    expect((await job(first.jobId)).dueAt).toEqual(at(30));
    expect(await deliverCandidateEmail(first.jobId, at(29))).toBe("busy");
    expect(sent).toHaveLength(0);
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("Confidential");
    expect(sent[0].html).not.toContain("Confidential");
    expect(sent[0].html).toContain("Otwórz czat z HR");
    expect(sent[0].text).toContain("https://example.com");
    expect(await deliverCandidateEmail(first.jobId, at(31))).toBe("done");
    expect(sent).toHaveLength(1);
  });

  it("waits thirty minutes for a new HR message without the previous three-hour delay", async () => {
    const first = await hr(0);
    await deliverCandidateEmail(first.jobId, at(30));
    const second = await hr(45);
    expect((await job(second.jobId)).dueAt).toEqual(at(75));
    expect(await deliverCandidateEmail(second.jobId, at(74))).toBe("busy");
    expect(sent).toHaveLength(1);
    expect(await deliverCandidateEmail(second.jobId, at(75))).toBe("sent");
    expect(sent).toHaveLength(2);
    expect(await env.db.transaction(tx => recordAdminMessageEmail(tx, sessionId, first.message.id, at(400)))).toBeNull();
    await deliverCandidateEmail(second.jobId, at(500));
    expect(sent).toHaveLength(2);
  });

  it("notifies at minute 90 after the candidate reads and replies at minute 60, then HR replies again", async () => {
    const first = await hr(0);
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("sent");
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString(), at(60));
    await env.db.transaction(async tx => {
      await lockVisitor(tx, sessionId);
      const [reply] = await tx.insert(schema.messages).values({ conversationId, sender: "visitor", body: "Dziękuję",
        clientMessageId: randomUUID(), createdAt: at(60) }).returning();
      expect(await recordAdminMessageEmail(tx, sessionId, reply.id, at(60))).toBeNull();
    });
    const next = await hr(60);
    expect(next.jobId).not.toBe(first.jobId);
    expect((await job(next.jobId)).dueAt).toEqual(at(90));
    expect(await deliverCandidateEmail(next.jobId, at(89))).toBe("busy");
    expect(sent).toHaveLength(1);
    expect(await deliverCandidateEmail(next.jobId, at(90))).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("cancels the next notification when the candidate reads the new HR reply before minute 90", async () => {
    const first = await hr(0);
    await deliverCandidateEmail(first.jobId, at(30));
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString(), at(60));
    const next = await hr(60);
    expect((await job(next.jobId)).dueAt).toEqual(at(90));
    await markCandidateMessagesRead(sessionId, next.message.sequence.toString(), at(89));
    expect((await job(next.jobId)).status).toBe("cancelled");
    expect(await deliverCandidateEmail(next.jobId, at(90))).toBe("done");
    expect(sent).toHaveLength(1);
  });

  it("gives a new HR reply just after an email its own full thirty-minute wait", async () => {
    const first = await hr(0);
    await deliverCandidateEmail(first.jobId, at(30));
    const next = await hr(30.5);
    expect((await job(next.jobId)).dueAt).toEqual(at(60.5));
    expect(await deliverCandidateEmail(next.jobId, at(60))).toBe("busy");
    expect(sent).toHaveLength(1);
    expect(await deliverCandidateEmail(next.jobId, at(60.5))).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("does not periodically remind about the same unread HR message", async () => {
    const first = await hr(0);
    await deliverCandidateEmail(first.jobId, at(30));
    for (const minute of [60, 90, 180, 500]) {
      expect(await deliverCandidateEmail(first.jobId, at(minute))).toBe("done");
      expect(await env.db.transaction(tx => recordAdminMessageEmail(tx, sessionId, first.message.id, at(minute)))).toBeNull();
    }
    expect(sent).toHaveLength(1);
    const jobs = await env.db.select().from(schema.candidateEmailJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("sent");
  });

  it("moves a queued legacy deadline forward on a new HR reply without changing the logical email or duplicating delivery", async () => {
    const first = await hr(0);
    await deliverCandidateEmail(first.jobId, at(30));
    const legacy = await hr(45);
    await env.db.update(schema.candidateEmailJobs).set({ dueAt: at(210) }).where(eq(schema.candidateEmailJobs.id, legacy.jobId));
    await enqueueCandidateEmail(legacy.jobId);
    const before = await job(legacy.jobId);
    expect(before.queuedAt).not.toBeNull();
    expect(scheduled).toEqual([{ id: legacy.jobId, at: at(210) }]);

    // Another HR reply in the same minute joins the existing unread group.
    expect((await hr(45)).jobId).toBe(legacy.jobId);
    expect(await job(legacy.jobId)).toMatchObject({
      id: before.id, dedupeKey: before.dedupeKey, dueAt: at(75), queuedAt: null,
      attempts: 0, throughSequence: null,
    });
    await enqueueCandidateEmail(legacy.jobId);
    expect(scheduled).toEqual([{ id: legacy.jobId, at: at(210) }, { id: legacy.jobId, at: at(75) }]);
    expect((await hr(50)).jobId).toBe(legacy.jobId);
    await enqueueCandidateEmail(legacy.jobId);
    expect((await job(legacy.jobId)).dueAt).toEqual(at(75));
    expect(scheduled).toHaveLength(2);
    expect(await deliverCandidateEmail(legacy.jobId, at(74))).toBe("busy");
    expect(await deliverCandidateEmail(legacy.jobId, at(75))).toBe("sent");
    expect(await deliverCandidateEmail(legacy.jobId, at(210))).toBe("done");
    expect(sent).toHaveLength(2);
  });

  it("leaves an already queued legacy deadline unchanged until another HR reply arrives", async () => {
    const first = await hr(0);
    await deliverCandidateEmail(first.jobId, at(30));
    const legacy = await hr(45);
    await env.db.update(schema.candidateEmailJobs).set({ dueAt: at(210) }).where(eq(schema.candidateEmailJobs.id, legacy.jobId));
    await enqueueCandidateEmail(legacy.jobId);
    expect(await deliverCandidateEmail(legacy.jobId, at(75))).toBe("busy");
    expect((await job(legacy.jobId)).dueAt).toEqual(at(210));
    expect(scheduled).toEqual([{ id: legacy.jobId, at: at(210) }]);
    expect(sent).toHaveLength(1);
  });

  it("does not accelerate a legacy notification when an HR send is retried with the same clientMessageId", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const [lead] = await env.db.insert(schema.leads).values({ sessionId }).returning();
      const first = await hr(0);
      await deliverCandidateEmail(first.jobId, at(30));
      const legacy = await hr(45);
      await env.db.update(schema.candidateEmailJobs).set({ dueAt: at(210) }).where(eq(schema.candidateEmailJobs.id, legacy.jobId));
      vi.setSystemTime(at(45));
      await enqueueCandidateEmail(legacy.jobId);
      const before = await job(legacy.jobId);

      vi.setSystemTime(at(46));
      await postAdminMessage(lead.id, {
        clientMessageId: legacy.message.clientMessageId, body: legacy.message.body,
      });
      expect(await job(legacy.jobId)).toEqual(before);
      expect(await env.db.select().from(schema.candidateEmailJobs)).toHaveLength(2);
      expect(await env.db.select().from(schema.messages)).toHaveLength(2);
      expect(scheduled).toEqual([{ id: legacy.jobId, at: at(210) }]);

      vi.setSystemTime(at(50));
      await postAdminMessage(lead.id, { clientMessageId: randomUUID(), body: "A genuinely new HR reply" });
      expect(await job(legacy.jobId)).toMatchObject({
        id: before.id, dedupeKey: before.dedupeKey, dueAt: at(75), queuedAt: at(50),
        attempts: 0, throughSequence: null,
      });
      expect(await env.db.select().from(schema.candidateEmailJobs)).toHaveLength(2);
      expect(await env.db.select().from(schema.messages)).toHaveLength(3);
      expect(scheduled).toEqual([{ id: legacy.jobId, at: at(210) }, { id: legacy.jobId, at: at(75) }]);
      expect(await deliverCandidateEmail(legacy.jobId, at(75))).toBe("sent");
      expect(await deliverCandidateEmail(legacy.jobId, at(210))).toBe("done");
      expect(sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not shorten a quota retry even though no provider send has been reserved", async () => {
    const first = await hr(0);
    vi.stubEnv("BREVO_DAILY_LIMIT", "1"); vi.stubEnv("BREVO_OTP_RESERVE", "1");
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("rescheduled");
    const before = await job(first.jobId);
    expect(before).toMatchObject({ dueAt: at(90), attempts: 1, lastError: "quota", throughSequence: first.message.sequence });
    expect(await env.db.select().from(schema.candidateEmailSends)).toHaveLength(0);
    expect((await hr(45)).jobId).toBe(first.jobId);
    expect(await job(first.jobId)).toEqual(before);
    await enqueueCandidateEmail(first.jobId);
    expect(scheduled).toEqual([{ id: first.jobId, at: at(90) }]);
    expect(sent).toHaveLength(0);
  });

  it("reading the chat cancels pending mail; a new conversation starts a fresh 30-minute wait", async () => {
    const first = await hr(0);
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString());
    expect((await job(first.jobId)).status).toBe("cancelled");
    await deliverCandidateEmail(first.jobId, at(30));
    expect(sent).toHaveLength(0);
    const second = await hr(20);
    expect((await job(second.jobId)).dueAt).toEqual(at(50));
    await deliverCandidateEmail(second.jobId, at(49));
    expect(sent).toHaveLength(0);
    await deliverCandidateEmail(second.jobId, at(50));
    expect(sent).toHaveLength(1);
  });

  it("partial reading/deletion does not send younger unread messages prematurely", async () => {
    const first = await hr(0);
    const second = await hr(20);
    await env.db.update(schema.messages).set({ deletedAt: at(21) }).where(eq(schema.messages.id, first.message.id));
    await deliverCandidateEmail(first.jobId, at(30));
    expect((await job(first.jobId)).dueAt).toEqual(at(50));
    expect(sent).toHaveLength(0);
    await markCandidateMessagesRead(sessionId, second.message.sequence.toString());
    await deliverCandidateEmail(first.jobId, at(50));
    expect(sent).toHaveLength(0);
  });

  it("foreign, future, visitor and automatic messages cannot advance a read cursor", async () => {
    const first = await hr(0);
    const otherSession = await newSession(env.db);
    const [conv] = await env.db.insert(schema.conversations).values({ sessionId: otherSession }).returning();
    const [foreign] = await env.db.insert(schema.messages).values({ conversationId: conv.id, sender: "admin", clientMessageId: randomUUID() }).returning();
    const [system] = await env.db.insert(schema.messages).values({ conversationId, sender: "system", clientMessageId: randomUUID() }).returning();
    const [visitor] = await env.db.insert(schema.messages).values({ conversationId, sender: "visitor", clientMessageId: randomUUID() }).returning();
    for (const value of [foreign.sequence.toString(), system.sequence.toString(), visitor.sequence.toString(), "9223372036854775808"]) {
      await expect(markCandidateMessagesRead(sessionId, value)).rejects.toMatchObject({ status: 400 });
    }
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString());
    expect((await env.db.select().from(schema.candidateEmailState))[0].lastReadSequence).toBe(first.message.sequence);
  });

  it("accepts a read receipt captured before an owned HR message was deleted", async () => {
    const first = await hr(0);
    const latest = await hr(10);
    await env.db.update(schema.messages).set({ deletedAt: at(11) }).where(eq(schema.messages.id, latest.message.id));
    await markCandidateMessagesRead(sessionId, latest.message.sequence.toString());
    expect((await env.db.select().from(schema.candidateEmailState))[0].lastReadSequence).toBe(latest.message.sequence);
    expect((await job(first.jobId)).status).toBe("cancelled");
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString());
    expect((await env.db.select().from(schema.candidateEmailState))[0].lastReadSequence).toBe(latest.message.sequence);
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("done");
    expect(sent).toHaveLength(0);
    const next = await hr(31);
    expect((await job(next.jobId)).dueAt).toEqual(at(61));
    expect(await deliverCandidateEmail(next.jobId, at(61))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("automatic messages never create chat emails", async () => {
    const [system] = await env.db.insert(schema.messages).values({ conversationId, sender: "system", clientMessageId: randomUUID() }).returning();
    expect(await env.db.transaction(tx => recordAdminMessageEmail(tx, sessionId, system.id))).toBeNull();
    expect(await env.db.select().from(schema.candidateEmailJobs)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("published rejection cancels pending chat mail and suppresses further notifications", async () => {
    const first = await hr(0);
    await env.db.insert(schema.leads).values({ sessionId, status: "rejected",
      candidateResultBody: "Dziękujemy za zgłoszenie.", candidateResultPublishedAt: at(10) });
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("done");
    expect((await job(first.jobId)).status).toBe("cancelled");
    expect((await hr(31)).jobId).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("an internal rejected status alone keeps the chat notification available", async () => {
    await env.db.insert(schema.leads).values({ sessionId, status: "rejected" });
    const first = await hr(0);
    expect(first.jobId).toBeTruthy();
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("welcome is atomically recorded once and explains the current site and code login", async () => {
    const id = await env.db.transaction(tx => recordWelcomeEmail(tx, sessionId));
    expect(await env.db.transaction(tx => recordWelcomeEmail(tx, sessionId))).toBe(id);
    await deliverCandidateEmail(id!, new Date());
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Zaloguj się");
    expect(sent[0].text).toContain("jednorazowym kodem");
    expect(sent[0].text).toContain("https://example.com");
    expect(await env.db.transaction(tx => recordWelcomeEmail(tx, sessionId))).toBeNull();
  });

  it("durable rows survive enqueue failures and are recovered without affecting chat", async () => {
    const first = await hr(0);
    const schedule = vi.fn().mockRejectedValue(new Error("private provider details"));
    setCandidateEmailQueue({ schedule });
    await expect(enqueueCandidateEmail(first.jobId)).rejects.toThrow("candidate_email_queue_unavailable");
    expect(schedule).toHaveBeenCalledTimes(3);
    expect((await job(first.jobId)).status).toBe("pending");
    expect((await job(first.jobId)).lastError).toBe("queue_unavailable");
    setCandidateEmailQueue({ async schedule() {} });
    const result = await recoverCandidateEmails();
    expect(result.failed).toBe(0);
    expect(result.recovered).toBe(1);
  });

  it("temporary provider failures retry, keeping one durable group", async () => {
    const first = await hr(0);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("rescheduled");
    expect((await job(first.jobId)).status).toBe("pending");
    setCandidateEmailTransport(async p => { sent.push(p); return "ok"; });
    expect(await deliverCandidateEmail(first.jobId, at(31))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("does not retry a notification after its last unread message was deleted", async () => {
    const first = await hr(0);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("rescheduled");
    await env.db.update(schema.messages).set({ deletedAt: at(30.5) }).where(eq(schema.messages.id, first.message.id));
    setCandidateEmailTransport(async p => { sent.push(p); return "unexpected"; });
    expect(await deliverCandidateEmail(first.jobId, at(31))).toBe("done");
    expect((await job(first.jobId)).status).toBe("cancelled");
    expect(sent).toHaveLength(0);
    // The failed transport could have delivered before timing out. A new group
    // must still respect the notification cooldown and a new message's wait.
    const next = await hr(32);
    expect((await job(next.jobId)).dueAt).toEqual(at(62));
    expect(await deliverCandidateEmail(next.jobId, at(61))).toBe("busy");
    expect(sent).toHaveLength(0);
  });

  it("reading an attempted group preserves the cooldown before a later message arrives", async () => {
    const first = await hr(0);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    await deliverCandidateEmail(first.jobId, at(30));
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString(), at(31));
    expect((await job(first.jobId)).status).toBe("cancelled");
    const next = await hr(32);
    expect((await job(next.jobId)).dueAt).toEqual(at(62));
    setCandidateEmailTransport(async p => { sent.push(p); return "next"; });
    expect(await deliverCandidateEmail(first.jobId, at(32))).toBe("done");
    expect(await deliverCandidateEmail(next.jobId, at(61))).toBe("busy");
    expect(await deliverCandidateEmail(next.jobId, at(62))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("reading the attempted original never sends a retry for a newer unread message", async () => {
    const first = await hr(0);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    await deliverCandidateEmail(first.jobId, at(30));
    const newer = await hr(30.5);
    expect(newer.jobId).toBe(first.jobId);
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString(), at(30.75));
    setCandidateEmailTransport(async p => { sent.push(p); return "new-group"; });
    expect(await deliverCandidateEmail(first.jobId, at(31))).toBe("done");
    expect((await job(first.jobId)).status).toBe("cancelled");
    expect(sent).toHaveLength(0);
    const [later] = (await env.db.select().from(schema.candidateEmailJobs)).filter(row => row.status === "pending");
    expect(later.id).not.toBe(first.jobId);
    expect(later.dueAt).toEqual(at(61));
    expect(scheduled.some(row => row.id === later.id)).toBe(true);
    expect(await deliverCandidateEmail(later.id, at(61))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("a partially read attempted range still waits thirty minutes for its oldest remaining message", async () => {
    const first = await hr(0);
    await hr(20);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    await deliverCandidateEmail(first.jobId, at(30));
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString(), at(31));
    setCandidateEmailTransport(async p => { sent.push(p); return "remaining"; });
    expect(await deliverCandidateEmail(first.jobId, at(31))).toBe("rescheduled");
    expect((await job(first.jobId)).dueAt).toEqual(at(50));
    expect(sent).toHaveLength(0);
    expect(await deliverCandidateEmail(first.jobId, at(50))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("a message arriving during transport stays in a later group and inherits the cooldown", async () => {
    const first = await hr(0);
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pause = new Promise<void>(resolve => { release = resolve; });
    setCandidateEmailTransport(async p => { sent.push(p); started(); await pause; return "first"; });
    const sending = deliverCandidateEmail(first.jobId, at(30));
    await ready;
    const second = await hr(31);
    expect(second.jobId).not.toBe(first.jobId);
    release();
    expect(await sending).toBe("sent");
    expect((await job(second.jobId)).dueAt).toEqual(at(61));
    const [state] = await env.db.select().from(schema.candidateEmailState);
    expect(state.lastNotifiedSequence).toBe(first.message.sequence);
    setCandidateEmailTransport(async p => { sent.push(p); return "second"; });
    expect(await deliverCandidateEmail(second.jobId, at(61))).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("an uncertain send also holds the cooldown so a fresh group cannot duplicate it", async () => {
    const first = await hr(0);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    await deliverCandidateEmail(first.jobId, at(30));
    await deliverCandidateEmail(first.jobId, at(56));
    expect((await job(first.jobId)).status).toBe("uncertain");
    const second = await hr(57);
    expect((await job(second.jobId)).dueAt).toEqual(at(87));
    expect(await env.db.transaction(tx => recordAdminMessageEmail(tx, sessionId, first.message.id, at(58)))).toBeNull();
  });

  it("a stale sending job merges a newer pending group before rescheduling", async () => {
    const first = await hr(0);
    await env.db.update(schema.candidateEmailJobs).set({ status: "sending", lockedAt: at(30),
      throughSequence: first.message.sequence }).where(eq(schema.candidateEmailJobs.id, first.jobId));
    const second = await hr(31);
    expect(second.jobId).not.toBe(first.jobId);
    await markCandidateMessagesRead(sessionId, first.message.sequence.toString());
    expect(await deliverCandidateEmail(first.jobId, at(33))).toBe("rescheduled");
    expect((await job(first.jobId)).status).toBe("pending");
    expect((await job(first.jobId)).dueAt).toEqual(at(61));
    expect((await job(second.jobId)).status).toBe("cancelled");
    expect(sent).toHaveLength(0);
    expect(await deliverCandidateEmail(first.jobId, at(61))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("recovery after provider acceptance does not consume messages received after that email", async () => {
    const first = await hr(0);
    // The process stopped after Brevo accepted the email and before the job's
    // final transaction. A new HR message arrives while that job is stale.
    await env.db.update(schema.candidateEmailJobs).set({ status: "sending", lockedAt: at(30),
      throughSequence: first.message.sequence }).where(eq(schema.candidateEmailJobs.id, first.jobId));
    await env.db.insert(schema.candidateEmailSends).values({ id: `candidate-${first.jobId}`, kind: "chat",
      status: "accepted", providerId: "already-delivered", createdAt: at(30) });
    await env.db.update(schema.messages).set({ deletedAt: at(30.5) }).where(eq(schema.messages.id, first.message.id));
    const second = await hr(31);
    expect(await deliverCandidateEmail(first.jobId, at(33))).toBe("sent");
    expect(sent).toHaveLength(0); // Only finalizes the already accepted email.
    expect((await env.db.select().from(schema.candidateEmailState))[0].lastNotifiedSequence).toBe(first.message.sequence);
    expect((await job(second.jobId)).status).toBe("pending");
    expect((await job(second.jobId)).dueAt).toEqual(at(63));
    expect(await deliverCandidateEmail(second.jobId, at(63))).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  it("a retry retains the original range and recreates the later notification after merging", async () => {
    const first = await hr(0);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    expect(await deliverCandidateEmail(first.jobId, at(30))).toBe("rescheduled");
    const second = await hr(30.5);
    expect(second.jobId).toBe(first.jobId);
    expect(await job(first.jobId)).toMatchObject({
      dueAt: at(31), attempts: 1, throughSequence: first.message.sequence, lastError: "temporary",
    });
    setCandidateEmailTransport(async p => { sent.push(p); return "deduplicated-original"; });
    expect(await deliverCandidateEmail(first.jobId, at(31))).toBe("sent");
    expect((await env.db.select().from(schema.candidateEmailState))[0].lastNotifiedSequence).toBe(first.message.sequence);
    const [later] = (await env.db.select().from(schema.candidateEmailJobs)).filter(row => row.status === "pending");
    expect(later).toBeDefined();
    expect(later.id).not.toBe(first.jobId);
    expect(later.dueAt).toEqual(at(61));
    expect(await deliverCandidateEmail(later.id, at(61))).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("feature off avoids queues, sends and notification records", async () => {
    vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
    expect(candidateEmailConfigured()).toBe(false);
    expect((await hr(0)).jobId).toBeNull();
    expect(await env.db.transaction(tx => recordWelcomeEmail(tx, sessionId))).toBeNull();
    expect(await recoverCandidateEmails()).toEqual({ recovered: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe("Brevo boundary", () => {
  it("uses self-contained HTML and plain text, with no recipient identity, attachments or tracking consent", async () => {
    setCandidateEmailTransport(null);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "test-id" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await sendCandidateCode("candidate@example.com", "123456", randomUUID());
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.htmlContent).toContain('<html lang="pl">');
    expect(payload.htmlContent).toContain("123456");
    expect(payload.htmlContent).not.toContain("candidate@example.com");
    expect(payload.textContent).not.toContain("candidate@example.com");
    expect(payload.htmlContent).not.toMatch(/<(?:img|script|svg|iframe|link|form)\b/i);
    expect(payload.attachment).toBeUndefined();
    expect(payload.to).toEqual([{ email: "candidate@example.com", contactPixelTrackingConsent: false }]);
    expect(payload.textContent).toContain("123456");
    expect(payload.headers.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: "bad_request", message: "secret candidate@example.com" }), { status: 400 }));
    await expect(sendCandidateCode("candidate@example.com", "123456", randomUUID())).rejects.toThrow(/^candidate_email_rejected$/);
  });

  it("uses a stable UUID for the same logical send and a different UUID for another", async () => {
    setCandidateEmailTransport(null);
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValue(new Response(JSON.stringify({ messageId: "retry-id" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const challenge = randomUUID();
    await expect(sendCandidateCode("candidate@example.com", "123456", challenge)).rejects.toMatchObject({ code: "temporary" });
    await sendCandidateCode("candidate@example.com", "123456", challenge);
    fetch.mockResolvedValue(new Response(JSON.stringify({ messageId: "new-id" }), { status: 201 }));
    await sendCandidateCode("candidate@example.com", "654321", randomUUID());
    const keys = fetch.mock.calls.map(call => JSON.parse(call[1].body).headers.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("reserves quota for OTP and never charges a retry twice", async () => {
    vi.stubEnv("BREVO_DAILY_LIMIT", "3"); vi.stubEnv("BREVO_OTP_RESERVE", "1");
    await sendCandidateEmail("welcome", "candidate@example.com", "title", "text", "one", start);
    await sendCandidateEmail("chat", "candidate@example.com", "title", "text", "two", start);
    await expect(sendCandidateEmail("chat", "candidate@example.com", "title", "text", "three", start)).rejects.toMatchObject({ code: "quota" });
    await sendCandidateEmail("otp", "candidate@example.com", "title", "text", "code", start);
    await sendCandidateEmail("chat", "candidate@example.com", "title", "text", "two", start);
    expect(sent).toHaveLength(3);
    await expect(sendCandidateEmail("otp", "candidate@example.com", "title", "text", "code-two", start)).rejects.toMatchObject({ code: "quota" });
  });

  it("never resends an ambiguous send after Brevo's idempotency lifetime", async () => {
    const transport = vi.fn().mockRejectedValue(new CandidateEmailError("temporary"));
    setCandidateEmailTransport(transport);
    await expect(sendCandidateEmail("chat", "candidate@example.com", "title", "text", "ambiguous", start)).rejects.toMatchObject({ code: "temporary" });
    await expect(sendCandidateEmail("chat", "candidate@example.com", "title", "text", "ambiguous", at(26))).rejects.toMatchObject({ code: "uncertain" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
