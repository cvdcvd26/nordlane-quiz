import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { postVisitorMessage } from "@/server/services/chat";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { getLeadDetails, listLeads, postAdminMessage, updateCandidateOutcome, updateLeadStatus } from "@/server/services/admin";
import { createLegacyScheduledSubmission, newSession, PNG, setupTestEnv } from "./helpers";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => { await env.db.delete(schema.visitorSessions); });
afterAll(async () => { await env.client.close(); });

async function candidate(name = "Jan Kowalski", legacy = false) {
  const sessionId = await newSession(env.db);
  await saveContact(sessionId, { name, phone: "600123456", telegram: "" });
  const [lead] = await env.db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.sessionId, sessionId));
  const leadId = lead.id;
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sessionId, key, "yes");
  const file = await uploadFile({ sessionId, purpose: "submission", uploadedBy: "visitor", file: { name: "test.png", type: "image/png", buffer: PNG } });
  const input = { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis wykonania zadania testowego." };
  const submission = legacy
    ? (await createLegacyScheduledSubmission(sessionId, input)).submission
    : await submitTask(sessionId, input);
  const [scheduled] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.submissionId, submission.submissionId));
  return { sessionId, leadId, scheduled };
}

describe("automatic needs-reply queue", () => {
  it("does not queue contacts, submissions or automatic greetings without a visitor message", async () => {
    const c = await candidate();
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
    await deliverScheduledMessage(c.scheduled.id, new Date(Date.now() + 120000));
    expect((await listLeads({ queue: "needs_reply" })).needsReplyCount).toBe(0);
    expect((await getLeadDetails(c.leadId)).lead.needsReply).toBe(false);
  });

  it("queues a visitor message, keeps the first waiting time, and ignores a later legacy automatic message", async () => {
    const c = await candidate("Jan Kowalski", true);
    const first = await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: "Pierwsze pytanie" });
    await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: "Dodatkowe pytanie" });
    expect(await deliverScheduledMessage(c.scheduled.id, new Date(Date.now() + 120000))).toBe("sent");
    const queue = await listLeads({ queue: "needs_reply" });
    expect(queue.total).toBe(1);
    expect(queue.needsReplyCount).toBe(1);
    expect(queue.items[0]).toMatchObject({ id: c.leadId, needsReply: true, replyWaitingSince: first.message.createdAt, lastVisitorMessage: "Dodatkowe pytanie", status: "new" });
    expect((await listLeads({})).items.map(item => item.id)).toContain(c.leadId);
    expect((await getLeadDetails(c.leadId)).lead).toMatchObject({ needsReply: true, replyWaitingSince: first.message.createdAt });
  });

  it("clears on a manual reply and returns on a new message, even if an old reply is retried", async () => {
    const c = await candidate();
    await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: "Pytanie" });
    const clientMessageId = randomUUID();
    await postAdminMessage(c.leadId, { clientMessageId, body: "Odpowiedź administratora" });
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
    const second = await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: "Kolejne pytanie" });
    await postAdminMessage(c.leadId, { clientMessageId, body: "Odpowiedź administratora" });
    expect((await listLeads({ queue: "needs_reply" })).items[0].replyWaitingSince).toBe(second.message.createdAt);
    await updateLeadStatus(c.leadId, { status: "completed" });
    expect((await listLeads({ queue: "needs_reply" })).items[0].status).toBe("completed");
  });

  it("uses message sequence rather than equal or out-of-order timestamps", async () => {
    const c = await candidate();
    const first = await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: "Question" });
    await postAdminMessage(c.leadId, { clientMessageId: randomUUID(), body: "Reply" });
    await env.db.update(schema.messages).set({ createdAt: new Date("2026-01-01T10:00:00Z") });
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
    const next = await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: "Another question" });
    await env.db.update(schema.messages).set({ createdAt: new Date("2025-01-01T10:00:00Z") }).where(eq(schema.messages.id, next.message.id));
    expect((await listLeads({ queue: "needs_reply" })).items[0].lastVisitorMessage).toBe("Another question");
    expect(first.message.sequence).not.toBe(next.message.sequence);
  });

  it("sorts the longest waiting first and combines search, status and pagination without changing the global count", async () => {
    const candidates = await Promise.all([candidate("Anna Testowa"), candidate("Jan Testowy"), candidate("Maja Testowa")]);
    for (const [index, c] of candidates.entries()) {
      const sent = await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: `Pytanie ${index}` });
      await env.db.update(schema.messages).set({ createdAt: new Date(`2026-10-22T1${2 - index}:00:00Z`) }).where(eq(schema.messages.id, sent.message.id));
    }
    await updateLeadStatus(candidates[1].leadId, { status: "in_progress" });
    const queue = await listLeads({ queue: "needs_reply", sort: "desc", pageSize: "5" });
    expect(queue.items.map(item => item.id)).toEqual(candidates.toReversed().map(c => c.leadId));
    const found = await listLeads({ queue: "needs_reply", q: "Jan", status: "in_progress" });
    expect(found.items.map(item => item.id)).toEqual([candidates[1].leadId]);
    expect(found.needsReplyCount).toBe(3);
    expect((await listLeads({ queue: "needs_reply", page: "2", pageSize: "5" })).items).toEqual([]);
  });

  it("includes attachment-only visitor messages and clears on an attachment-only admin reply", async () => {
    const c = await candidate();
    const file = async (uploadedBy: "visitor" | "admin") => uploadFile({ sessionId: c.sessionId, purpose: "chat", uploadedBy, file: { name: "test.png", type: "image/png", buffer: PNG } });
    await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), fileIds: [(await file("visitor")).id] });
    expect((await listLeads({ queue: "needs_reply" })).items[0]).toMatchObject({ needsReply: true, lastVisitorMessage: "" });
    await postAdminMessage(c.leadId, { clientMessageId: randomUUID(), fileIds: [(await file("admin")).id] });
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
  });

  it("hides closed rejected chats, keeps internal rejection separate, and restores the queue if reopened", async () => {
    const c = await candidate();
    await postVisitorMessage(c.sessionId, { clientMessageId: randomUUID(), body: "Pytanie" });
    await updateLeadStatus(c.leadId, { status: "rejected" });
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(1);
    await updateCandidateOutcome(c.leadId, { action: "publish", body: "Dziękujemy za udział w rekrutacji." });
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
    await updateCandidateOutcome(c.leadId, { action: "retract" });
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(1);
  });
});
