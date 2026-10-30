import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/db";
import { QUESTION_KEYS } from "@/config/content";
import { defaultSettings, uploadConfig } from "@/config/settings";
import { POST as uploadPost } from "@/app/api/uploads/route";
import { POST as chatPost } from "@/app/api/chat/route";
import { GET as fileGet } from "@/app/api/files/[id]/route";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { getLeadDetails, updateCandidateOutcome, updateLeadStatus } from "@/server/services/admin";
import { updateSettings } from "@/server/settings";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { EXE, newSession, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let pdf: Buffer;
const headers = { host: "example.com", origin: "https://example.com" };
const context = (id: string) => ({ params: Promise.resolve({ id }) });

async function candidate(answers = QUESTION_KEYS.length) {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "PDF upload test", phone: "600123456" });
  for (const question of QUESTION_KEYS.slice(0, answers)) await saveAnswer(sid, question, "yes");
  const token = randomBytes(32).toString("base64url");
  await env.db.update(schema.visitorSessions).set({ tokenHash: createHash("sha256").update(token).digest("hex") })
    .where(eq(schema.visitorSessions.id, sid));
  jar.set("nl_visitor", token);
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  return { sid, lead, token };
}

function uploadRequest(bytes = pdf, name = "Umowa_Test_Żółć.pdf", type = "application/pdf", purpose = "chat") {
  const form = new FormData();
  form.set("purpose", purpose);
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("https://example.com/api/uploads", { method: "POST", headers, body: form });
}

function messageRequest(fileId: string) {
  return new Request("https://example.com/api/chat", {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ clientMessageId: randomUUID(), body: "", fileIds: [fileId] }),
  });
}

beforeAll(async () => {
  env = await setupTestEnv();
  const document = await PDFDocument.create();
  document.addPage([300, 200]).drawText("Visitor PDF attachment test");
  pdf = Buffer.from(await document.save());
});
beforeEach(async () => {
  jar.clear(); env.blobs.clear(); env.queued.length = 0;
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.appSettings);
  await env.db.delete(schema.rateLimits);
  await updateSettings(defaultSettings);
});
afterAll(async () => { await env.client.close(); });

describe("visitor PDF attachments in chat", () => {
  it("uploads a PDF through multipart, sends it without text and exposes the original file in the administrator conversation", async () => {
    const { sid, lead } = await candidate();
    const uploaded = await uploadPost(uploadRequest());
    expect(uploaded.status).toBe(201);
    const { file } = await uploaded.json();
    expect(file).toMatchObject({ name: "Umowa_Test_Żółć.pdf", mime: "application/pdf", size: pdf.length });
    const sent = await chatPost(messageRequest(file.id));
    expect(sent.status).toBe(201);
    const { message } = await sent.json();
    expect(message).toMatchObject({ sender: "visitor", body: "", files: [file] });
    const details = await getLeadDetails(lead.id);
    expect(details.messages.at(-1)).toMatchObject({ id: message.id, sender: "visitor", files: [file] });
    expect(details.lead.needsReply).toBe(true);
    expect(details.submission).toBeNull();
    await expect(submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [file.id],
      review: "Opis wykonanego zadania testowego." })).rejects.toMatchObject({ code: "files_missing" });
    expect(await env.db.select().from(schema.taskSubmissions)).toHaveLength(0);
    expect(await env.db.select().from(schema.scheduledMessages)).toHaveLength(0);
    const [saved] = await env.db.select().from(schema.files).where(eq(schema.files.id, file.id));
    expect(saved).toMatchObject({ sessionId: sid, uploadedBy: "visitor", purpose: "chat", messageId: message.id });
    const downloaded = await fileGet(new Request(`https://example.com${file.url}?download`), context(file.id));
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("application/pdf");
    expect(downloaded.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(Buffer.from(await downloaded.arrayBuffer()).equals(pdf)).toBe(true);
  });

  it("continues accepting chat screenshots", async () => {
    await candidate();
    const response = await uploadPost(uploadRequest(PNG, "screen.png", "image/png"));
    expect(response.status).toBe(201);
    const { file } = await response.json();
    expect(file).toMatchObject({ name: "screen.png", mime: "image/png" });
    expect((await chatPost(messageRequest(file.id))).status).toBe(201);
  });

  it("rejects PDF task submissions and executables disguised as chat PDFs before storage writes", async () => {
    await candidate();
    const task = await uploadPost(uploadRequest(pdf, "task.pdf", "application/pdf", "submission"));
    expect(task.status).toBe(400);
    expect(await task.json()).toMatchObject({ code: "file_type" });
    const spoof = await uploadPost(uploadRequest(EXE));
    expect(spoof.status).toBe(400);
    expect(await spoof.json()).toMatchObject({ code: "file_content" });
    expect(env.blobs.size).toBe(0);
    expect(await env.db.select().from(schema.files)).toHaveLength(0);
  });

  it("retains the file size limit for PDFs", async () => {
    await candidate();
    const oversized = Buffer.alloc(uploadConfig.maxFileSizeBytes + 1);
    pdf.copy(oversized);
    const response = await uploadPost(uploadRequest(oversized));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "file_size" });
    expect(env.blobs.size).toBe(0);
  });

  it("keeps incomplete, disabled and closed chat upload guards", async () => {
    await candidate(1);
    const early = await uploadPost(uploadRequest());
    expect(early.status).toBe(403);
    expect(await early.json()).toMatchObject({ code: "chat_not_available" });
    const ready = await candidate();
    await updateSettings({ ...defaultSettings, chatAttachmentsEnabled: false });
    const disabled = await uploadPost(uploadRequest());
    expect(disabled.status).toBe(400);
    expect(await disabled.json()).toMatchObject({ code: "bad_request" });
    expect(env.blobs.size).toBe(0);
    await updateSettings(defaultSettings);
    const screenshot = await uploadFile({ sessionId: ready.sid, purpose: "submission", uploadedBy: "visitor",
      file: { name: "task.png", type: "image/png", buffer: PNG } });
    await submitTask(ready.sid, { idempotencyKey: randomUUID(), fileIds: [screenshot.id], review: "Opis wykonanego zadania testowego." });
    await updateLeadStatus(ready.lead.id, { status: "rejected" });
    await updateCandidateOutcome(ready.lead.id, { action: "publish", body: "Dziękujemy za udział w rekrutacji." });
    const closed = await uploadPost(uploadRequest());
    expect(closed.status).toBe(403);
    expect(await closed.json()).toMatchObject({ code: "candidate_chat_closed" });
    expect(env.blobs.size).toBe(1);
  });

  it("does not let another visitor send or download an uploaded PDF", async () => {
    await candidate();
    const uploaded = await uploadPost(uploadRequest());
    expect(uploaded.status).toBe(201);
    const { file } = await uploaded.json();
    await candidate();
    const foreignSend = await chatPost(messageRequest(file.id));
    expect(foreignSend.status).toBe(409);
    expect(await foreignSend.json()).toMatchObject({ code: "file_missing" });
    const foreignRead = await fileGet(new Request(`https://example.com${file.url}?download`), context(file.id));
    expect(foreignRead.status).toBe(404);
    expect(await env.db.select().from(schema.messages)).toHaveLength(0);
  });
});
