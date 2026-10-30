import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema } from "@/db";
import { defaultSettings } from "@/config/settings";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { deliverScheduledMessage, deliverOverdue } from "@/server/services/delivery";
import { getVisitorChat } from "@/server/services/chat";
import { getSettings, updateSettings } from "@/server/settings";
import { setupTestEnv, newSession, PNG } from "./helpers";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.client.close(); });

async function readyTask() {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Anna", phone: "600123456" });
  for (const question of ["q1", "q2", "q3"]) await saveAnswer(sid, question, "yes");
  const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor",
    file: { name: "test.png", type: "image/png", buffer: PNG } });
  return { sid, file, input: { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Wszystko działa zgodnie z instrukcją." } };
}

it("returns the durable acknowledgement before any chat poll or queue delivery", async () => {
  const { sid, input } = await readyTask();
  const queueCalls = env.queued.length;
  env.queue.failNext = true;
  const result = await submitTask(sid, input);
  env.queue.failNext = false;
  expect(env.queued).toHaveLength(queueCalls);
  expect(result.acknowledgement).toMatchObject({ sender: "system", body: defaultSettings.autoMessageText, files: [] });
  expect(result.acknowledgement!.createdAt).toBe(result.submittedAt);
  const [job] = await env.db.select().from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.submissionId, result.submissionId));
  expect(job).toMatchObject({ status: "sent", attempts: 1, messageId: result.acknowledgement!.id, queueMessageId: null });
  expect(job.sentAt!.toISOString()).toBe(result.submittedAt);
  expect(job.scheduledFor.toISOString()).toBe(result.submittedAt);
  const [stored] = await env.db.select().from(schema.messages).where(eq(schema.messages.id, result.acknowledgement!.id));
  expect(stored.body).toBe(result.acknowledgement!.body);
  expect((await getVisitorChat(sid)).messages).toContainEqual(result.acknowledgement);
});

it("concurrent submissions and later retries return one unchanged acknowledgement", async () => {
  const { sid, input } = await readyTask();
  const results = await Promise.all([submitTask(sid, input), submitTask(sid, { ...input, idempotencyKey: randomUUID() })]);
  expect(results.filter(result => !result.duplicate)).toHaveLength(1);
  expect(results[0].submissionId).toBe(results[1].submissionId);
  expect(results[0].acknowledgement).toEqual(results[1].acknowledgement);
  await updateSettings({ ...defaultSettings, autoMessageText: "Nowa treść nie zmienia wcześniejszego potwierdzenia." });
  const retry = await submitTask(sid, { ...input, idempotencyKey: randomUUID() });
  expect(retry.duplicate).toBe(true);
  expect(retry.acknowledgement).toEqual(results[0].acknowledgement);
  const [conversation] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
  expect(await env.db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversation.id))).toHaveLength(1);
  await updateSettings(defaultSettings);
});

it("legacy callbacks and overdue sweeps cannot resend a new immediate acknowledgement", async () => {
  const { sid, input } = await readyTask();
  const result = await submitTask(sid, input);
  const [job] = await env.db.select().from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.submissionId, result.submissionId));
  expect(await deliverScheduledMessage(job.id, new Date(Date.now() + 86_400_000))).toBe("already_sent");
  await deliverOverdue({ now: new Date(Date.now() + 86_400_000) });
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  expect(lead.messageCount).toBe(1);
});

it("rolls back the task and file attachment when writing the acknowledgement fails", async () => {
  const { sid, file, input } = await readyTask();
  await env.client.exec("ALTER TABLE messages ADD CONSTRAINT test_reject_ack CHECK (sender <> 'system') NOT VALID");
  try {
    await expect(submitTask(sid, input)).rejects.toThrow();
    expect(await env.db.select().from(schema.taskSubmissions).where(eq(schema.taskSubmissions.sessionId, sid))).toHaveLength(0);
    const [pending] = await env.db.select().from(schema.files).where(eq(schema.files.id, file.id));
    expect(pending.submissionId).toBeNull();
  } finally {
    await env.client.exec("ALTER TABLE messages DROP CONSTRAINT test_reject_ack");
  }
  const retry = await submitTask(sid, input);
  expect(retry.duplicate).toBe(false);
  expect(retry.acknowledgement).not.toBeNull();
});

it("rolls back the inserted message too if recording successful delivery fails", async () => {
  const { sid, file, input } = await readyTask();
  await env.client.exec("ALTER TABLE scheduled_messages ADD CONSTRAINT test_reject_sent CHECK (status <> 'sent') NOT VALID");
  try {
    await expect(submitTask(sid, input)).rejects.toThrow();
    expect(await env.db.select().from(schema.taskSubmissions).where(eq(schema.taskSubmissions.sessionId, sid))).toHaveLength(0);
    const [conversation] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
    if (conversation) {
      expect(await env.db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversation.id))).toHaveLength(0);
    }
    const [pending] = await env.db.select().from(schema.files).where(eq(schema.files.id, file.id));
    expect(pending.submissionId).toBeNull();
  } finally {
    await env.client.exec("ALTER TABLE scheduled_messages DROP CONSTRAINT test_reject_sent");
  }
  expect((await submitTask(sid, input)).acknowledgement).not.toBeNull();
});

it("respects disabled auto replies and does not add one retrospectively on retry", async () => {
  const { sid, input } = await readyTask();
  await updateSettings({ ...defaultSettings, autoMessageEnabled: false });
  const result = await submitTask(sid, input);
  expect(result.acknowledgement).toBeNull();
  expect(await env.db.select().from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.submissionId, result.submissionId))).toHaveLength(0);
  await updateSettings(defaultSettings);
  expect((await submitTask(sid, input)).acknowledgement).toBeNull();
});

it("normalises saved legacy delays without losing the configured message", async () => {
  await env.db.insert(schema.appSettings).values([
    { key: "autoMessageMinDelaySeconds", value: 30 },
    { key: "autoMessageMaxDelaySeconds", value: 60 },
  ]).onConflictDoUpdate({ target: schema.appSettings.key, set: { value: 60 } });
  expect(await getSettings()).toMatchObject({ autoMessageMinDelaySeconds: 0, autoMessageMaxDelaySeconds: 0, autoMessageText: defaultSettings.autoMessageText });
  expect(await updateSettings({ ...defaultSettings, autoMessageMinDelaySeconds: 30, autoMessageMaxDelaySeconds: 60 }))
    .toMatchObject({ autoMessageMinDelaySeconds: 0, autoMessageMaxDelaySeconds: 0 });
});
