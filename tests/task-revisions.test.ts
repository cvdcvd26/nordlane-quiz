import { randomBytes, randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { saveContact } from "@/server/services/contact";
import { saveAnswer, getVisitorState } from "@/server/services/quiz";
import { submitTask } from "@/server/services/submission";
import { uploadFile, deletePendingFile, getReadableFile } from "@/server/services/uploads";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { getReplyQueueState } from "@/server/services/reply-queue";
import { updateCandidateOutcome, updateLeadStatus } from "@/server/services/admin";
import { updateSettings } from "@/server/settings";
import { defaultSettings, uploadConfig } from "@/config/settings";
import { candidateOutcomeConfig } from "@/config/candidate-outcome";
import { storage, setStorage } from "@/server/storage";
import { requestTaskRevision, getLeadRevisions, getVisitorRevision, submitTaskRevision, cancelTaskRevision, uploadRevisionFile, purgeTerminalRevisionFiles } from "@/server/services/task-revisions";
import { GET as visitorGet, POST as visitorPost } from "@/app/api/task-revisions/route";
import { POST as visitorUpload } from "@/app/api/task-revisions/uploads/route";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/leads/[id]/revisions/route";
import { POST as adminCancel } from "@/app/api/admin/leads/[id]/revisions/[revisionId]/cancel/route";
import { PNG, PDF, newSession, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined }) }));
const secret = "task-revision-test-secret-at-least-thirty-two-characters";
const screenshot = { name: "corrected.png", type: "image/png", buffer: PNG };
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let admin: typeof schema.adminUsers.$inferSelect;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  jar.clear(); vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  await env.db.delete(schema.visitorSessions); await env.db.delete(schema.adminUsers); await env.db.delete(schema.rateLimits);
  await env.db.delete(schema.appSettings);
  env.blobs.clear(); await updateSettings({ ...defaultSettings, autoMessageEnabled: false });
  [admin] = await env.db.insert(schema.adminUsers).values({ email: "revision@example.test", passwordHash: "unused", isTemporary: true }).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

async function candidate(submit = true) {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Revision candidate", phone: "600123456" });
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  if (submit) {
    for (const questionKey of ["q1", "q2", "q3"]) await saveAnswer(sid, questionKey, "yes");
    const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: screenshot });
    await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "The original answer stays unchanged." });
  }
  return { sid, lead };
}
const request = (leadId: number, sendMessage = true, id: string = randomUUID()) => requestTaskRevision(leadId, admin.id, {
  id, instructions: "Proszę poprawić drugi zrzut ekranu i doprecyzować odpowiedź.", sendMessage,
});
async function visitorCookie(sid: string) {
  const token = randomBytes(32).toString("base64url");
  await env.db.update(schema.visitorSessions).set({ tokenHash: createHash("sha256").update(token).digest("hex") }).where(eq(schema.visitorSessions.id, sid));
  jar.set("nl_visitor", token);
}
async function adminCookie() {
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id)
    .setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
}
const headers = { host: "example.com", origin: "https://example.com", "content-type": "application/json" };
const http = (path: string, input: unknown, origin = headers.origin) => new Request(`https://example.com${path}`, { method: "POST", headers: { ...headers, origin }, body: JSON.stringify(input) });

describe("structured task revisions", () => {
  it("stores instructions and the optional admin message atomically and keeps request retries idempotent", async () => {
    const { sid, lead } = await candidate();
    const id = randomUUID();
    const first = await request(lead.id, true, id);
    expect(await request(lead.id, true, id)).toEqual(first);
    expect((await getVisitorRevision(sid)).revision).toEqual(first);
    const chat = await getVisitorChat(sid);
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({ sender: "admin", body: first.instructions });
    expect((await getLeadRevisions(lead.id)).revisions).toHaveLength(1);
    const [row] = await env.db.select().from(schema.taskRevisions);
    expect(row).toMatchObject({ createdBy: admin.id, requestMessageId: chat.messages[0].id, responseMessageId: null });
    await expect(request(lead.id)).rejects.toMatchObject({ code: "revision_pending" });
    expect((await getVisitorChat(sid)).messages).toHaveLength(1);
  });

  it("supports instructions without duplicating them into chat, requires the original submission and isolates sessions", async () => {
    const { sid, lead } = await candidate();
    const other = await candidate(false);
    await expect(request(other.lead.id)).rejects.toMatchObject({ code: "revision_not_submitted" });
    const revision = await request(lead.id, false);
    expect((await getVisitorChat(sid)).messages).toHaveLength(0);
    expect((await getVisitorRevision(other.sid)).revision).toBeNull();
    await expect(submitTaskRevision(other.sid, { revisionId: revision.id, body: "Someone else's response" })).rejects.toMatchObject({ code: "revision_not_submitted" });
    const submittedOther = await candidate();
    await expect(submitTaskRevision(submittedOther.sid, { revisionId: revision.id, body: "Someone else's response" })).rejects.toMatchObject({ code: "revision_inactive" });
    await expect(cancelTaskRevision(other.lead.id, revision.id)).rejects.toMatchObject({ status: 404 });
    await expect(request(other.lead.id, true, revision.id)).rejects.toMatchObject({ code: "revision_duplicate" });
    expect((await getVisitorRevision(sid)).revision?.status).toBe("pending");
  });

  it("accepts corrected text and screenshots without repeating the form and preserves all original data", async () => {
    const { sid, lead } = await candidate();
    const stateBefore = await getVisitorState(sid);
    const [original] = await env.db.select().from(schema.taskSubmissions).where(eq(schema.taskSubmissions.sessionId, sid));
    const originalFiles = await env.db.select().from(schema.files).where(eq(schema.files.submissionId, original.id));
    const revision = await request(lead.id);
    const file = await uploadRevisionFile(sid, revision.id, screenshot);
    const result = await submitTaskRevision(sid, { revisionId: revision.id, body: "Poprawiona odpowiedź z dodatkowymi szczegółami.", fileIds: [file.id] });
    expect(result.status).toBe("submitted");
    expect(result.submittedAt).toBeTruthy();
    const chat = await getVisitorChat(sid);
    expect(chat.messages.map(message => message.sender)).toEqual(["admin", "visitor"]);
    expect(chat.messages.at(-1)).toMatchObject({ body: "Poprawiona odpowiedź z dodatkowymi szczegółami.", files: [{ id: file.id }] });
    expect(await getReplyQueueState(lead.id)).toMatchObject({ needsReply: true });
    expect((await getLeadRevisions(lead.id)).revisions[0]).toMatchObject({ response: { body: chat.messages.at(-1)!.body, files: [{ id: file.id }] } });
    expect((await env.db.select().from(schema.taskSubmissions).where(eq(schema.taskSubmissions.sessionId, sid)))[0]).toEqual(original);
    expect(await env.db.select().from(schema.files).where(eq(schema.files.submissionId, original.id))).toEqual(originalFiles);
    const after = await getVisitorState(sid);
    expect(after.contact).toEqual(stateBefore.contact); expect(after.answers).toEqual(stateBefore.answers); expect(after.submission).toEqual(stateBefore.submission);
    expect((await getVisitorRevision(sid)).files).toEqual([]);
  });

  it("stores exactly one response for concurrent retries and never replaces submitted text or attachments", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    const input = { revisionId: revision.id, body: "Pierwsza poprawiona odpowiedź." };
    const [first, second] = await Promise.all([submitTaskRevision(sid, input), submitTaskRevision(sid, input)]);
    expect(first).toEqual(second);
    expect(await submitTaskRevision(sid, { revisionId: revision.id, body: "A different retry cannot replace history.", fileIds: [randomUUID()] })).toEqual(first);
    expect((await getVisitorChat(sid)).messages.filter(message => message.sender === "visitor")).toHaveLength(1);
    expect((await getVisitorChat(sid)).messages.at(-1)?.body).toBe(input.body);
  });

  it("prevents ordinary chat client ids from reserving a structured response", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    await postVisitorMessage(sid, { clientMessageId: `revision-response:${revision.id}`, body: "An ordinary chat message." });
    await submitTaskRevision(sid, { revisionId: revision.id, body: "The corrected task response." });
    expect((await getLeadRevisions(lead.id)).revisions[0].response?.body).toBe("The corrected task response.");
    expect((await getVisitorChat(sid)).messages.filter(message => message.sender === "visitor")).toHaveLength(2);
  });

  it("rejects foreign, already attached, admin and ordinary-chat files and rolls back the response atomically", async () => {
    const { sid, lead } = await candidate();
    const other = await candidate();
    const revision = await request(lead.id);
    const otherRevision = await request(other.lead.id);
    const foreign = await uploadRevisionFile(other.sid, otherRevision.id, screenshot);
    const adminFile = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "admin", file: screenshot });
    const ordinaryChat = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: screenshot });
    const good = await uploadRevisionFile(sid, revision.id, screenshot);
    for (const invalid of [foreign.id, adminFile.id, ordinaryChat.id, randomUUID()]) {
      await expect(submitTaskRevision(sid, { revisionId: revision.id, body: "Must roll back", fileIds: [good.id, invalid] })).rejects.toMatchObject({ code: "revision_files_missing" });
      expect((await getVisitorRevision(sid)).revision?.status).toBe("pending");
      expect((await getVisitorChat(sid)).messages.filter(message => message.sender === "visitor")).toEqual([]);
      expect((await env.db.select().from(schema.files).where(eq(schema.files.id, good.id)))[0].messageId).toBeNull();
    }
    expect(await getReadableFile(foreign.id, { sessionId: sid })).toBeNull();
    expect(await getReadableFile(adminFile.id, { sessionId: sid })).toBeNull();
    await submitTaskRevision(sid, { revisionId: revision.id, fileIds: [good.id] });
    await expect(deletePendingFile(sid, good.id)).rejects.toMatchObject({ code: "file_attached" });
    const next = await request(lead.id);
    await expect(submitTaskRevision(sid, { revisionId: next.id, fileIds: [good.id] })).rejects.toMatchObject({ code: "revision_files_missing" });
  });

  it("allows screenshots when ordinary chat attachments are disabled, validates bytes and enforces the screenshot count", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    await updateSettings({ ...defaultSettings, autoMessageEnabled: false, chatAttachmentsEnabled: false });
    await expect(uploadRevisionFile(sid, revision.id, { name: "fake.png", type: "image/png", buffer: PDF })).rejects.toThrow();
    const files = [];
    for (let i = 0; i < uploadConfig.maxFilesPerSubmission; i++) files.push(await uploadRevisionFile(sid, revision.id, screenshot));
    const countBefore = env.blobs.size;
    await expect(uploadRevisionFile(sid, revision.id, screenshot)).rejects.toMatchObject({ code: "file_count" });
    expect(env.blobs.size).toBe(countBefore);
    expect((await getVisitorRevision(sid)).files.map(file => file.id)).toEqual(files.map(file => file.id));
    await submitTaskRevision(sid, { revisionId: revision.id, fileIds: files.map(file => file.id) });
    expect((await getVisitorChat(sid)).messages.at(-1)?.files).toHaveLength(uploadConfig.maxFilesPerSubmission);
  });

  it("cancels idempotently, preserves history, rejects stale responses and accepts another request", async () => {
    const { sid, lead } = await candidate();
    const first = await request(lead.id);
    const oldFile = await uploadRevisionFile(sid, first.id, screenshot);
    const cancelled = await cancelTaskRevision(lead.id, first.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await cancelTaskRevision(lead.id, first.id)).toEqual(cancelled);
    await expect(submitTaskRevision(sid, { revisionId: first.id, body: "A stale response" })).rejects.toMatchObject({ code: "revision_inactive" });
    await expect(uploadRevisionFile(sid, first.id, screenshot)).rejects.toMatchObject({ code: "revision_inactive" });
    const second = await request(lead.id);
    expect((await getVisitorRevision(sid)).revision?.id).toBe(second.id);
    await expect(submitTaskRevision(sid, { revisionId: second.id, fileIds: [oldFile.id] })).rejects.toMatchObject({ code: "revision_files_missing" });
    await submitTaskRevision(sid, { revisionId: second.id, body: "Nowa poprawiona odpowiedź." });
    expect((await getLeadRevisions(lead.id)).revisions.map(item => item.status)).toEqual(["submitted", "cancelled"]);
    expect((await getVisitorChat(sid)).messages.map(message => message.sender)).toEqual(["admin", "admin", "visitor"]);
    await expect(deletePendingFile(sid, oldFile.id)).rejects.toMatchObject({ status: 404 });
  });

  it("serializes cancellation and candidate response so cancellation never overwrites a submitted revision", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    const [cancelled, submitted] = await Promise.allSettled([
      cancelTaskRevision(lead.id, revision.id), submitTaskRevision(sid, { revisionId: revision.id, body: "Concurrent corrected answer." }),
    ]);
    const stored = (await getLeadRevisions(lead.id)).revisions[0];
    if (stored.status === "submitted") {
      expect(submitted.status).toBe("fulfilled"); expect(cancelled.status).toBe("rejected");
      if (cancelled.status === "rejected") expect(cancelled.reason.code).toBe("revision_changed");
      expect(stored.response).not.toBeNull();
    } else {
      expect(stored.status).toBe("cancelled"); expect(cancelled.status).toBe("fulfilled"); expect(submitted.status).toBe("rejected");
      expect(stored.response).toBeNull();
    }
    expect((await getVisitorChat(sid)).messages.filter(message => message.sender === "visitor")).toHaveLength(stored.status === "submitted" ? 1 : 0);
  });

  it("permits only one pending request during concurrent administrator sends", async () => {
    const { lead } = await candidate();
    const results = await Promise.allSettled([request(lead.id), request(lead.id)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.code).toBe("revision_pending");
    expect((await getLeadRevisions(lead.id)).revisions).toHaveLength(1);
  });

  it("rechecks pending status after external upload and cleans the private blob if cancellation wins", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    const original = storage();
    let started!: () => void; let finish!: () => void; let key = "";
    const uploadingStarted = new Promise<void>(resolve => { started = resolve; });
    const finishUploading = new Promise<void>(resolve => { finish = resolve; });
    setStorage({ ...original, async put(storageKey, bytes, mime) {
      key = storageKey; await original.put(storageKey, bytes, mime); started(); await finishUploading;
    } });
    try {
      const upload = uploadRevisionFile(sid, revision.id, screenshot);
      await uploadingStarted;
      await cancelTaskRevision(lead.id, revision.id);
      finish();
      await expect(upload).rejects.toMatchObject({ code: "revision_inactive" });
      expect(env.blobs.has(key)).toBe(false);
      expect(await env.db.select().from(schema.files).where(eq(schema.files.storageKey, key))).toEqual([]);
    } finally { finish(); setStorage(original); }
  });

  it("makes cancelled drafts unreadable, retries failed cleanup and keeps them out of ordinary chat quota", async () => {
    const { sid, lead } = await candidate();
    const original = storage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const draftIds: string[] = [];
    setStorage({ ...original, async delete(key) {
      if (key.includes("/revisions/")) throw new Error("Storage cleanup temporarily unavailable");
      await original.delete(key);
    } });
    try {
      for (let round = 0; round < 2; round++) {
        const revision = await request(lead.id);
        for (let i = 0; i < uploadConfig.maxFilesPerSubmission; i++) draftIds.push((await uploadRevisionFile(sid, revision.id, screenshot)).id);
        await cancelTaskRevision(lead.id, revision.id);
      }
      for (const id of draftIds) {
        expect(await getReadableFile(id, { sessionId: sid })).toBeNull();
        expect(await getReadableFile(id, { admin: true })).toBeNull();
      }
      await expect(postVisitorMessage(sid, { clientMessageId: randomUUID(), fileIds: [draftIds[0]] })).rejects.toMatchObject({ code: "file_missing" });
      const ordinary = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: screenshot });
      expect(ordinary.id).toBeTruthy();
      expect((await env.db.select().from(schema.files).where(eq(schema.files.sessionId, sid))).filter(file => draftIds.includes(file.id))).toHaveLength(draftIds.length);
      setStorage(original);
      expect(await purgeTerminalRevisionFiles()).toEqual({ deleted: draftIds.length, pending: 0 });
      for (const id of draftIds) expect(await env.db.select().from(schema.files).where(eq(schema.files.id, id))).toEqual([]);
    } finally { setStorage(original); warn.mockRestore(); }
  });

  it("cleans an object if storage writes successfully and then rejects", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    const original = storage();
    const before = env.blobs.size;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let key = "";
    setStorage({ ...original, async put(storageKey, bytes, mime) {
      key = storageKey; await original.put(storageKey, bytes, mime); throw new Error("Private storage transport error");
    } });
    try {
      await expect(uploadRevisionFile(sid, revision.id, screenshot)).rejects.toMatchObject({ code: "revision_failed" });
      expect(key).toContain("/revisions/"); expect(env.blobs.size).toBe(before); expect(env.blobs.has(key)).toBe(false);
      expect(await env.db.select().from(schema.files).where(eq(schema.files.storageKey, key))).toEqual([]);
      expect(warn.mock.calls).toEqual([["task_revisions.upload_failed"]]);
    } finally { setStorage(original); warn.mockRestore(); }
  });

  it("redacts private request and response parameters on database trigger failures and rolls back their chat messages", async () => {
    const { sid, lead } = await candidate();
    const privateInstructions = "PRIVATE_REVISION_INSTRUCTIONS_8ce45f";
    const privateBody = "PRIVATE_REVISION_RESPONSE_76a9be";
    const [session] = await env.db.select().from(schema.visitorSessions).where(eq(schema.visitorSessions.id, sid));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.client.exec(`
      create function reject_revision_request() returns trigger language plpgsql as $$ begin raise exception 'Simulated write failure'; end $$;
      create trigger reject_revision_request before insert on task_revisions for each row execute function reject_revision_request();
    `);
    try {
      await adminCookie();
      const response = await adminPost(http(`/api/admin/leads/${lead.id}/revisions`, { id: randomUUID(), instructions: privateInstructions }), { params: Promise.resolve({ id: String(lead.id) }) });
      expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ code: "revision_failed" });
      expect((await getVisitorChat(sid)).messages).toEqual([]);
      expect((await getLeadRevisions(lead.id)).revisions).toEqual([]);
      await env.client.exec("drop trigger reject_revision_request on task_revisions; drop function reject_revision_request();");
      const revision = await request(lead.id);
      await env.client.exec(`
        create function reject_revision_response() returns trigger language plpgsql as $$ begin
          if new.sender = 'visitor' then raise exception 'Simulated response failure'; end if; return new; end $$;
        create trigger reject_revision_response before insert on messages for each row execute function reject_revision_response();
      `);
      await visitorCookie(sid);
      const responseFailure = await visitorPost(http("/api/task-revisions", { revisionId: revision.id, body: privateBody }));
      expect(responseFailure.status).toBe(500); expect(await responseFailure.json()).toMatchObject({ code: "revision_failed" });
      expect((await getVisitorRevision(sid)).revision?.status).toBe("pending");
      expect((await getVisitorChat(sid)).messages.map(message => message.sender)).toEqual(["admin"]);
      const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(logged).not.toContain(privateInstructions); expect(logged).not.toContain(privateBody); expect(logged).not.toContain(session.tokenHash);
      expect(warn.mock.calls).toContainEqual(["task_revisions.request_failed"]);
      expect(warn.mock.calls).toContainEqual(["task_revisions.response_failed"]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      await env.client.exec("drop trigger if exists reject_revision_request on task_revisions; drop function if exists reject_revision_request(); drop trigger if exists reject_revision_response on messages; drop function if exists reject_revision_response();");
      warn.mockRestore(); error.mockRestore();
    }
  });

  it("closes revisions on published refusal, hides the candidate card and prevents later uploads before storage", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    await updateLeadStatus(lead.id, { status: "rejected" });
    await updateCandidateOutcome(lead.id, { action: "publish", body: candidateOutcomeConfig.defaultBody });
    const put = vi.spyOn(storage(), "put");
    try {
      await expect(request(lead.id)).rejects.toMatchObject({ code: "candidate_chat_closed" });
      await expect(submitTaskRevision(sid, { revisionId: revision.id, body: "Closed response" })).rejects.toMatchObject({ code: "candidate_chat_closed" });
      await expect(uploadRevisionFile(sid, revision.id, screenshot)).rejects.toMatchObject({ code: "candidate_chat_closed" });
      expect(put).not.toHaveBeenCalled();
      expect(await getVisitorRevision(sid)).toEqual({ revision: null, files: [] });
      expect((await getLeadRevisions(lead.id)).closed).toBe(true);
    } finally { put.mockRestore(); }
  });

  it("protects admin writes and history with authentication and same-origin checks", async () => {
    const { lead } = await candidate();
    const ctx = { params: Promise.resolve({ id: String(lead.id) }) };
    const path = `/api/admin/leads/${lead.id}/revisions`;
    const input = { id: randomUUID(), instructions: "Proszę poprawić zadanie.", sendMessage: true };
    expect((await adminGet(new Request(`https://example.com${path}`), ctx)).status).toBe(401);
    expect((await adminPost(http(path, input), ctx)).status).toBe(401);
    await adminCookie();
    expect((await adminPost(http(path, input, "https://evil.example"), ctx)).status).toBe(403);
    expect((await adminPost(http(path, input), ctx)).status).toBe(201);
    expect((await adminGet(new Request(`https://example.com${path}`), ctx)).status).toBe(200);
    const cancelCtx = { params: Promise.resolve({ id: String(lead.id), revisionId: input.id }) };
    expect((await adminCancel(http(`${path}/${input.id}/cancel`, {}, "https://evil.example"), cancelCtx)).status).toBe(403);
    expect((await adminCancel(http(`${path}/${input.id}/cancel`, {}), cancelCtx)).status).toBe(200);
  });

  it("protects candidate endpoints, permits revision screenshots with chat attachments disabled and rejects cross-origin responses", async () => {
    const { sid, lead } = await candidate();
    const revision = await request(lead.id);
    const path = "/api/task-revisions";
    expect((await visitorGet()).status).toBe(401);
    await visitorCookie(sid);
    expect((await visitorGet()).status).toBe(200);
    await updateSettings({ ...defaultSettings, autoMessageEnabled: false, chatAttachmentsEnabled: false });
    const form = new FormData(); form.set("revisionId", revision.id); form.set("file", new File([new Uint8Array(PNG)], "correction.png", { type: "image/png" }));
    const response = await visitorUpload(new Request("https://example.com/api/task-revisions/uploads", { method: "POST", headers: { host: "example.com", origin: headers.origin }, body: form }));
    expect(response.status).toBe(201);
    const saved = await response.json();
    const input = { revisionId: revision.id, fileIds: [saved.file.id] };
    expect((await visitorPost(http(path, input, "https://evil.example"))).status).toBe(403);
    expect((await visitorPost(http(path, input))).status).toBe(201);
    expect((await getVisitorRevision(sid)).revision?.status).toBe("submitted");
    expect((await env.db.select().from(schema.files).where(and(eq(schema.files.id, saved.file.id), eq(schema.files.sessionId, sid))))[0].messageId).toBeTruthy();
  });

  it("gates every visitor revision endpoint during maintenance before parsing or file storage", async () => {
    await env.db.insert(schema.appSettings).values({ key: "maintenanceEnabled", value: true });
    const put = vi.spyOn(storage(), "put");
    try {
      // No session or valid payload is required: the maintenance gate runs first.
      const responses = await Promise.all([
        visitorGet(), visitorPost(http("/api/task-revisions", null)),
        visitorUpload(new Request("https://example.com/api/task-revisions/uploads", { method: "POST", body: "invalid-multipart" })),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("60");
        expect(await response.json()).toMatchObject({ code: "maintenance" });
      }
      expect(put).not.toHaveBeenCalled();
      expect(await env.db.select().from(schema.rateLimits)).toEqual([]);
    } finally { put.mockRestore(); }
  });
});
