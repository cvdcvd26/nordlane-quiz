import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db";
import { QUESTION_KEYS } from "@/config/content";
import { defaultSettings } from "@/config/settings";
import { updateSettings } from "@/server/settings";
import { saveContact } from "@/server/services/contact";
import { getVisitorState, saveAnswer } from "@/server/services/quiz";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { uploadFile, getReadableFile } from "@/server/services/uploads";
import { getLeadDetails, listLeads, postAdminMessage, updateCandidateOutcome, updateLeadStatus } from "@/server/services/admin";
import { submitTask } from "@/server/services/submission";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { GET as chatGet, POST as chatPost } from "@/app/api/chat/route";
import { POST as uploadPost } from "@/app/api/uploads/route";
import { newSession, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined }) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const image = { name: "question.png", type: "image/png", buffer: PNG };
const unavailable = { status: 403, code: "chat_not_available" };
const headers = { host: "example.com", origin: "https://example.com", "content-type": "application/json" };
const messageRequest = (body: unknown, origin = headers.origin) => new Request("https://example.com/api/chat", {
  method: "POST", headers: { ...headers, origin }, body: JSON.stringify(body),
});

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  jar.clear(); env.queued.length = 0; env.blobs.clear();
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.rateLimits);
  await env.db.delete(schema.appSettings);
  await updateSettings(defaultSettings);
});
afterAll(async () => { await env.client.close(); });

async function candidate(answers = QUESTION_KEYS.length) {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Task stage candidate", phone: "600123456" });
  for (const key of QUESTION_KEYS.slice(0, answers)) await saveAnswer(sid, key, "yes");
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  return { sid, lead };
}

async function visitorCookie(sid: string) {
  const token = randomBytes(32).toString("base64url");
  await env.db.update(schema.visitorSessions).set({ tokenHash: createHash("sha256").update(token).digest("hex") })
    .where(eq(schema.visitorSessions.id, sid));
  jar.set("nl_visitor", token);
}

async function submit(sid: string) {
  const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: image });
  return submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis wykonanego zadania testowego." });
}

describe("chat available during the task", () => {
  it("requires saved contact and all current answers, rejecting early chat reads, sends and uploads before storage writes", async () => {
    const blank = await newSession(env.db);
    const answersOnly = await newSession(env.db);
    for (const key of QUESTION_KEYS) await saveAnswer(answersOnly, key, "yes");
    const partial = await candidate(QUESTION_KEYS.length - 1);
    // An answer to an old/unknown question cannot replace the missing current answer.
    await env.db.insert(schema.quizAnswers).values({ sessionId: partial.sid, questionKey: "old-question", answer: "yes" });
    for (const sid of [blank, answersOnly, partial.sid]) {
      await expect(getVisitorChat(sid)).rejects.toMatchObject(unavailable);
      await expect(postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Pytanie" })).rejects.toMatchObject(unavailable);
      await expect(uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: image })).rejects.toMatchObject(unavailable);
    }
    expect(env.blobs.size).toBe(0);
    expect(await env.db.select().from(schema.conversations)).toHaveLength(0);
    expect(await env.db.select().from(schema.messages)).toHaveLength(0);
    expect(await env.db.select().from(schema.files)).toHaveLength(0);
  });

  it("opens the assigned HR chat, queues the candidate question and leaves the task unsubmitted without an automatic acknowledgement", async () => {
    const { sid, lead } = await candidate();
    const opened = await getVisitorChat(sid);
    expect(opened.manager.id).toBe(lead.managerId);
    expect(opened.messages).toHaveLength(0);
    expect(opened.attachmentsEnabled).toBe(true);
    expect((await getLeadDetails(lead.id)).lead.needsReply).toBe(false);
    const input = { clientMessageId: randomUUID(), body: "Który zrzut ekranu przesłać?" };
    const first = await postVisitorMessage(sid, input);
    expect((await postVisitorMessage(sid, input)).message.id).toBe(first.message.id);
    const inbox = await listLeads({ queue: "needs_reply" });
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({ id: lead.id, stage: "task", submitted: false, needsReply: true, status: "new", lastVisitorMessage: input.body });
    expect((await getVisitorState(sid)).submission).toBeNull();
    expect(await env.db.select().from(schema.taskSubmissions)).toHaveLength(0);
    expect(await env.db.select().from(schema.scheduledMessages)).toHaveLength(0);
    expect(env.queued).toHaveLength(0);
    expect((await getVisitorChat(sid)).messages).toHaveLength(1);
  });

  it("preserves the conversation, HR manager, answers and attachments when the actual task is later submitted", async () => {
    const { sid, lead } = await candidate();
    const chatFile = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: image });
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Czy to właściwy ekran?", fileIds: [chatFile.id] });
    await postAdminMessage(lead.id, { clientMessageId: randomUUID(), body: "Tak, proszę kontynuować zadanie." });
    const before = await getVisitorChat(sid);
    const [conversation] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
    expect(env.queued).toHaveLength(0);

    const submission = await submit(sid);
    const after = await getVisitorChat(sid);
    expect(after.manager).toEqual(before.manager);
    expect(after.messages).toEqual([...before.messages, submission.acknowledgement]);
    expect(submission.acknowledgement).toMatchObject({ sender: "system", body: defaultSettings.autoMessageText, files: [] });
    expect(after.messages[0].files).toEqual([chatFile]);
    expect((await getVisitorState(sid)).submission?.id).toBe(submission.submissionId);
    expect((await listLeads({ q: String(lead.id) })).items[0].stage).toBe("submitted");
    const conversations = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
    expect(conversations).toHaveLength(1); expect(conversations[0].id).toBe(conversation.id);
    const scheduled = await env.db.select().from(schema.scheduledMessages);
    expect(scheduled).toHaveLength(1); expect(env.queued).toHaveLength(0);
    expect(scheduled[0].conversationId).toBe(conversation.id);
    expect(scheduled[0]).toMatchObject({ status: "sent", messageId: submission.acknowledgement?.id, queueMessageId: null });
    expect(await deliverScheduledMessage(scheduled[0].id, new Date(Date.now() + 120000))).toBe("already_sent");
    const delivered = await getVisitorChat(sid);
    expect(delivered.messages.map(message => message.sender)).toEqual(["visitor", "admin", "system"]);
    expect(delivered.messages[2].body).toBe(defaultSettings.autoMessageText);
    expect(await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid))).toHaveLength(1);
  });

  it("keeps attachment ownership and published refusal guards at the earlier chat stage", async () => {
    const own = await candidate();
    const other = await candidate();
    const file = await uploadFile({ sessionId: own.sid, purpose: "chat", uploadedBy: "visitor", file: image });
    expect(await getReadableFile(file.id, { sessionId: other.sid })).toBeNull();
    await expect(postVisitorMessage(other.sid, { clientMessageId: randomUUID(), body: "Foreign file", fileIds: [file.id] }))
      .rejects.toMatchObject({ status: 409, code: "file_missing" });
    expect((await getVisitorChat(other.sid)).messages).toHaveLength(0);
    await postVisitorMessage(own.sid, { clientMessageId: randomUUID(), fileIds: [file.id] });
    expect((await getVisitorChat(own.sid)).messages[0].files[0].id).toBe(file.id);
    await submit(own.sid);
    await updateLeadStatus(own.lead.id, { status: "rejected" });
    await updateCandidateOutcome(own.lead.id, { action: "publish", body: "Dziękujemy za udział w rekrutacji." });
    const count = env.blobs.size;
    await expect(postVisitorMessage(own.sid, { clientMessageId: randomUUID(), body: "After refusal" }))
      .rejects.toMatchObject({ status: 403, code: "candidate_chat_closed" });
    await expect(uploadFile({ sessionId: own.sid, purpose: "chat", uploadedBy: "visitor", file: image }))
      .rejects.toMatchObject({ status: 403, code: "candidate_chat_closed" });
    expect(env.blobs.size).toBe(count);
    expect((await getVisitorChat(own.sid)).outcome?.status).toBe("rejected");
  });

  it("retains chat access for historical submitted sessions whose contact or current answers are missing", async () => {
    const { sid } = await candidate();
    await submit(sid);
    await env.db.delete(schema.visitorContacts).where(eq(schema.visitorContacts.sessionId, sid));
    await env.db.delete(schema.quizAnswers).where(eq(schema.quizAnswers.sessionId, sid));
    expect((await getVisitorChat(sid)).messages).toHaveLength(1);
    await expect(postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "History still works" })).resolves.toMatchObject({ message: { body: "History still works" } });
  });

  it("enforces session and origin checks on task-stage API requests and allows chat screenshots through the normal upload endpoint", async () => {
    expect((await chatGet(new Request("https://example.com/api/chat"))).status).toBe(401);
    const partial = await candidate(1);
    await visitorCookie(partial.sid);
    const denied = await chatGet(new Request("https://example.com/api/chat"));
    expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ code: "chat_not_available" });
    const ready = await candidate();
    await visitorCookie(ready.sid);
    expect((await chatGet(new Request("https://example.com/api/chat"))).status).toBe(200);
    expect((await chatPost(messageRequest({ clientMessageId: randomUUID(), body: "Question" }, "https://attacker.example"))).status).toBe(403);
    const sent = await chatPost(messageRequest({ clientMessageId: randomUUID(), body: "Pytanie przed wykonaniem zadania" }));
    expect(sent.status).toBe(201);
    const form = new FormData(); form.set("purpose", "chat"); form.set("file", new File([new Uint8Array(PNG)], "screen.png", { type: "image/png" }));
    const upload = await uploadPost(new Request("https://example.com/api/uploads", { method: "POST", headers: { host: "example.com", origin: "https://example.com" }, body: form }));
    expect(upload.status).toBe(201);
    const uploaded = await upload.json(); expect(uploaded.file.name).toBe("screen.png");
    await updateSettings({ ...defaultSettings, chatAttachmentsEnabled: false });
    const disabledForm = new FormData(); disabledForm.set("purpose", "chat"); disabledForm.set("file", new File([new Uint8Array(PNG)], "screen.png", { type: "image/png" }));
    expect((await uploadPost(new Request("https://example.com/api/uploads", { method: "POST", headers: { host: "example.com", origin: "https://example.com" }, body: disabledForm }))).status).toBe(400);
    expect((await getVisitorState(ready.sid)).submission).toBeNull();
    expect(env.queued).toHaveLength(0);
  });
});
