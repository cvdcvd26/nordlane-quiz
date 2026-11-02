import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema } from "@/db";
import { setupTestEnv, newSession } from "./helpers";
import { candidateEmailConfigured, CandidateEmailError, sendCandidateEmail, sendCandidateCode, setCandidateEmailTransport } from "@/server/brevo";
import { setCandidateEmailQueue } from "@/server/candidate-email-queue";
import { deliverCandidateEmail, enqueueCandidateEmail, markCandidateMessagesRead, recordAdminMessageEmail,
  recordWelcomeEmail, recoverCandidateEmails } from "@/server/services/candidate-email-notifications";
import { lockVisitor } from "@/server/session-lock";

type Env = Awaited<ReturnType<typeof setupTestEnv>>;
let env: Env;
let sessionId: string;
let conversationId: string;
const start = new Date("2026-11-01T12:00:00Z");
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
const sent: { email: string; subject: string; text: string; id: string }[] = [];
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
    expect(sent[0].text).toContain("https://example.com");
    expect(await deliverCandidateEmail(first.jobId, at(31))).toBe("done");
    expect(sent).toHaveLength(1);
  });

  it("waits three hours after the previous email, only for new unnotified messages", async () => {
    const first = await hr(0);
    await deliverCandidateEmail(first.jobId, at(30));
    const second = await hr(45);
    expect((await job(second.jobId)).dueAt).toEqual(at(210));
    await deliverCandidateEmail(second.jobId, at(180));
    expect(sent).toHaveLength(1);
    await deliverCandidateEmail(second.jobId, at(210));
    expect(sent).toHaveLength(2);
    expect(await env.db.transaction(tx => recordAdminMessageEmail(tx, sessionId, first.message.id, at(400)))).toBeNull();
    await deliverCandidateEmail(second.jobId, at(500));
    expect(sent).toHaveLength(2);
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
    expect(sent[0].text).toContain("Moje zgłoszenie");
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
    expect((await job(second.jobId)).dueAt).toEqual(at(210));
    const [state] = await env.db.select().from(schema.candidateEmailState);
    expect(state.lastNotifiedSequence).toBe(first.message.sequence);
    setCandidateEmailTransport(async p => { sent.push(p); return "second"; });
    expect(await deliverCandidateEmail(second.jobId, at(210))).toBe("sent");
    expect(sent).toHaveLength(2);
  });

  it("an uncertain send also holds the cooldown so a fresh group cannot duplicate it", async () => {
    const first = await hr(0);
    setCandidateEmailTransport(async () => { throw new CandidateEmailError("temporary"); });
    await deliverCandidateEmail(first.jobId, at(30));
    await deliverCandidateEmail(first.jobId, at(56));
    expect((await job(first.jobId)).status).toBe("uncertain");
    const second = await hr(57);
    expect((await job(second.jobId)).dueAt).toEqual(at(236));
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
  it("uses only plain text, no chat excerpts or tracking consent; errors do not leak response data", async () => {
    setCandidateEmailTransport(null);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "test-id" }), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await sendCandidateCode("candidate@example.com", "123456", randomUUID());
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.htmlContent).toBeUndefined();
    expect(payload.attachment).toBeUndefined();
    expect(payload.to).toEqual([{ email: "candidate@example.com", contactPixelTrackingConsent: false }]);
    expect(payload.textContent).toContain("123456");
    expect(payload.headers.idempotencyKey).toMatch(/^otp-/);
    fetch.mockResolvedValue(new Response(JSON.stringify({ code: "bad_request", message: "secret candidate@example.com" }), { status: 400 }));
    await expect(sendCandidateCode("candidate@example.com", "123456", randomUUID())).rejects.toThrow(/^candidate_email_rejected$/);
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
