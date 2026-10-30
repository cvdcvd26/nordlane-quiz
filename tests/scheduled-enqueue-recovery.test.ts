import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@/db";
import { defaultSettings } from "@/config/settings";
import { setQueue } from "@/server/queue";
import { updateSettings } from "@/server/settings";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { newSession, PNG, setupTestEnv } from "./helpers";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.appSettings);
  env.queued.length = 0; env.queue.failNext = false;
  setQueue(env.queue);
  await updateSettings(defaultSettings);
});
afterAll(async () => { await env.client.close(); });

async function candidate() {
  const sessionId = await newSession(env.db);
  await saveContact(sessionId, { name: "Enqueue recovery test", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sessionId, key, "yes");
  const file = await uploadFile({ sessionId, purpose: "submission", uploadedBy: "visitor", file: {
    name: "task.png", type: "image/png", buffer: PNG,
  } });
  const input = { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis zadania do testu odzyskiwania kolejki." };
  return { sessionId, input };
}

async function failedEnqueue() {
  const value = await candidate();
  env.queue.failNext = true;
  const submission = await submitTask(value.sessionId, value.input);
  const [job] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.submissionId, submission.submissionId));
  expect(job.queueMessageId).toBeNull(); expect(job.lastError).toContain("enqueue failed");
  return { ...value, submission, job };
}

const loadJob = async (id: string) => (await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, id)))[0];

describe("retrying a committed submission repairs only its unqueued auto message", () => {
  it("repairs a failed enqueue using the same job and scheduled second, without another submission or early auto message", async () => {
    const { sessionId, input, submission, job } = await failedEnqueue();
    const retry = await submitTask(sessionId, input);
    expect(retry).toEqual({ ...submission, duplicate: true });
    const repaired = await loadJob(job.id);
    expect(repaired.scheduledFor).toEqual(job.scheduledFor);
    expect(repaired.queueMessageId).toBeTruthy(); expect(repaired.lastError).toBeNull();
    expect(env.queued).toEqual([{ id: job.id, at: job.scheduledFor }]);
    expect(await env.db.select().from(schema.scheduledMessages)).toHaveLength(1);
    expect(await env.db.select().from(schema.taskSubmissions)).toHaveLength(1);
    expect(await env.db.select().from(schema.messages)).toHaveLength(0);
    expect(await deliverScheduledMessage(job.id, job.scheduledFor)).toBe("sent");
    expect(await deliverScheduledMessage(job.id, job.scheduledFor)).toBe("already_sent");
    expect(await env.db.select().from(schema.messages)).toHaveLength(1);
  });

  it("does not enqueue a pending job already accepted by the external queue", async () => {
    const { sessionId, input } = await candidate();
    const submission = await submitTask(sessionId, input);
    const [job] = await env.db.select().from(schema.scheduledMessages);
    expect(job.status).toBe("pending"); expect(job.queueMessageId).toBeTruthy();
    await submitTask(sessionId, input);
    expect(env.queued).toHaveLength(1);
    expect(await loadJob(job.id)).toEqual(job);
    expect((await env.db.select().from(schema.taskSubmissions))[0].id).toBe(submission.submissionId);
  });

  it.each(["sent", "cancelled"] as const)("never requeues an unqueued %s job", async status => {
    const { sessionId, input, job } = await failedEnqueue();
    if (status === "sent") await deliverScheduledMessage(job.id, job.scheduledFor);
    else await env.db.update(schema.scheduledMessages).set({ status, lastError: "candidate result published" }).where(eq(schema.scheduledMessages.id, job.id));
    const before = await loadJob(job.id);
    await submitTask(sessionId, input);
    expect(env.queued).toHaveLength(0); expect(await loadJob(job.id)).toEqual(before);
  });

  it("does not create a job for a submission originally saved with automatic messages disabled", async () => {
    const { sessionId, input } = await candidate();
    await updateSettings({ ...defaultSettings, autoMessageEnabled: false });
    await submitTask(sessionId, input);
    await updateSettings(defaultSettings);
    await submitTask(sessionId, input);
    expect(env.queued).toHaveLength(0);
    expect(await env.db.select().from(schema.scheduledMessages)).toHaveLength(0);
  });

  it("does not enqueue a pending recovery after automatic messages have been disabled", async () => {
    const { sessionId, input, job } = await failedEnqueue();
    await updateSettings({ ...defaultSettings, autoMessageEnabled: false });
    await submitTask(sessionId, input);
    expect(env.queued).toHaveLength(0); expect(await loadJob(job.id)).toEqual(job);
  });

  it("preserves the stored error when a local fallback queue returns null, and repairs it on a later accepted retry", async () => {
    const { sessionId, input, job } = await failedEnqueue();
    setQueue({ scheduleDelivery: async () => null });
    await submitTask(sessionId, input);
    expect(await loadJob(job.id)).toEqual(job);
    setQueue(env.queue);
    await submitTask(sessionId, input);
    expect((await loadJob(job.id)).lastError).toBeNull();
    expect(env.queued).toEqual([{ id: job.id, at: job.scheduledFor }]);
  });

  it("does not overwrite a concurrent cancellation after the queue accepts a recovery", async () => {
    const { sessionId, input, job } = await failedEnqueue();
    setQueue({ scheduleDelivery: async () => {
      await env.db.update(schema.scheduledMessages).set({ status: "cancelled", lastError: "candidate result published" }).where(eq(schema.scheduledMessages.id, job.id));
      return "accepted-before-cancel-observed";
    } });
    await submitTask(sessionId, input);
    expect(await loadJob(job.id)).toMatchObject({ status: "cancelled", queueMessageId: null, lastError: "candidate result published" });
    expect(await deliverScheduledMessage(job.id, job.scheduledFor)).toBe("cancelled");
    expect(await env.db.select().from(schema.messages)).toHaveLength(0);
  });

  it("does not overwrite a successful concurrent enqueue with a late failing retry", async () => {
    const { sessionId, input, job } = await failedEnqueue();
    let failFirst!: (error: Error) => void;
    let started!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    setQueue({ scheduleDelivery: async () => {
      if (++calls === 1) return new Promise<string>((_resolve, reject) => { failFirst = reject; started(); });
      return "accepted-concurrent-job";
    } });
    const first = submitTask(sessionId, input);
    await firstStarted;
    await submitTask(sessionId, input);
    failFirst(new Error("temporary queue failure"));
    await first;
    expect(await loadJob(job.id)).toMatchObject({ status: "pending", queueMessageId: "accepted-concurrent-job", lastError: null });
    expect(await env.db.select().from(schema.scheduledMessages)).toHaveLength(1);
    expect(await env.db.select().from(schema.taskSubmissions)).toHaveLength(1);
  });
});
