import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { setupTestEnv, newSession, PNG, createLegacyScheduledSubmission } from "./helpers";
import { schema } from "@/db";
import { candidateOutcomeConfig } from "@/config/candidate-outcome";
import { saveContact } from "@/server/services/contact";
import { getVisitorState, saveAnswer } from "@/server/services/quiz";
import { deletePendingFile, uploadFile } from "@/server/services/uploads";
import { setStorage, storage } from "@/server/storage";
import { submitTask } from "@/server/services/submission";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { getLeadDetails, postAdminMessage, updateCandidateOutcome, updateLeadStatus } from "@/server/services/admin";
import { POST } from "@/app/api/admin/leads/[id]/outcome/route";
import { GET as getChatRoute, POST as postChatRoute } from "@/app/api/chat/route";
import { POST as postUploadRoute } from "@/app/api/uploads/route";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });
const publish = { action: "publish", body: candidateOutcomeConfig.defaultBody };

async function candidate(submit: boolean | "legacy" = true) {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Candidate result test", phone: "600123456" });
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  if (submit) {
    for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
    const image = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: { name: "shot.png", type: "image/png", buffer: PNG } });
    const input = { idempotencyKey: randomUUID(), fileIds: [image.id], review: "Task verification completed." };
    if (submit === "legacy") await createLegacyScheduledSubmission(sid, input);
    else await submitTask(sid, input);
  }
  return { sid, lead };
}

async function jobFor(sid: string) {
  const [conversation] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
  const [job] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.conversationId, conversation.id));
  return job;
}

describe("explicit candidate result publication", () => {
  it("keeps an internal rejection private until explicitly published and restores the result on reload and chat polls", async () => {
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "rejected" });
    expect((await getVisitorState(sid)).outcome).toBeNull();
    expect((await getVisitorChat(sid)).outcome).toBeNull();
    const result = await updateCandidateOutcome(lead.id, publish);
    expect(result).toMatchObject({ status: "rejected", title: candidateOutcomeConfig.title, body: publish.body });
    expect((await getVisitorState(sid)).outcome).toEqual(result);
    expect((await getVisitorChat(sid)).outcome).toEqual(result);
    expect((await getLeadDetails(lead.id)).lead.outcome).toEqual(result);
    const messages = (await getVisitorChat(sid)).messages;
    expect(messages.map(message => message.sender)).toEqual(["system"]);
    // A retry preserves the existing acknowledgement and creates no further chat messages.
    expect(await updateCandidateOutcome(lead.id, publish)).toEqual(result);
    expect((await getVisitorChat(sid)).messages).toEqual(messages);
  });

  it("requires both a rejection and a submitted task, validates the text and does not expose another candidate's result", async () => {
    const unsubmitted = await candidate(false);
    await expect(updateCandidateOutcome(unsubmitted.lead.id, publish)).rejects.toMatchObject({ code: "outcome_status" });
    await updateLeadStatus(unsubmitted.lead.id, { status: "rejected" });
    await expect(updateCandidateOutcome(unsubmitted.lead.id, publish)).rejects.toMatchObject({ code: "outcome_not_submitted" });
    expect((await getVisitorState(unsubmitted.sid)).outcome).toBeNull();
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "rejected" });
    await expect(updateCandidateOutcome(lead.id, { action: "publish", body: "   " })).rejects.toThrow();
    await expect(updateCandidateOutcome(lead.id, { action: "publish", body: "x".repeat(candidateOutcomeConfig.maxBodyLength + 1) })).rejects.toThrow();
    await updateCandidateOutcome(lead.id, publish);
    expect((await getVisitorState(sid)).outcome?.body).toBe(publish.body);
    expect((await getVisitorState(unsubmitted.sid)).outcome).toBeNull();
  });

  it.each(["pending", "failed", "sending"] as const)("cancels an unsent %s welcome message, including queued retries and the chat fallback", async (status) => {
    const { sid, lead } = await candidate("legacy");
    const job = await jobFor(sid);
    await env.db.update(schema.scheduledMessages).set({ status, lockedAt: status === "sending" ? new Date() : null })
      .where(eq(schema.scheduledMessages.id, job.id));
    await updateLeadStatus(lead.id, { status: "rejected" });
    await updateCandidateOutcome(lead.id, publish);
    expect(await deliverScheduledMessage(job.id, new Date(job.scheduledFor.getTime() + 1000))).toBe("cancelled");
    expect((await getVisitorChat(sid)).messages).toHaveLength(0);
    expect(await jobFor(sid)).toMatchObject({ status: "cancelled", lockedAt: null, messageId: null });
  });

  it("preserves delivered history and admin replies while closing candidate writes until retraction", async () => {
    const { sid, lead } = await candidate();
    const job = await jobFor(sid);
    expect(await deliverScheduledMessage(job.id, new Date(job.scheduledFor.getTime() + 1))).toBe("already_sent");
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "May I ask a question?" });
    await updateLeadStatus(lead.id, { status: "rejected" });
    await updateCandidateOutcome(lead.id, publish);
    await expect(postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "A later message" }))
      .rejects.toMatchObject({ status: 403, code: "candidate_chat_closed" });
    await postAdminMessage(lead.id, { clientMessageId: randomUUID(), body: "Of course." });
    const chat = await getVisitorChat(sid);
    expect(chat.messages.map((message) => message.sender)).toEqual(["system", "visitor", "admin"]);
    expect((await jobFor(sid)).status).toBe("sent");
    await updateCandidateOutcome(lead.id, { action: "retract" });
    expect((await getVisitorState(sid)).outcome).toBeNull();
    expect((await getVisitorChat(sid)).messages).toEqual(chat.messages);
    expect((await getVisitorState(sid)).submission).not.toBeNull();
    expect((await getLeadDetails(lead.id)).lead.status).toBe("rejected");
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Chat is open again." });
    const attachment = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: { name: "reopened.png", type: "image/png", buffer: PNG } });
    expect(attachment.id).toBeTruthy();
    expect((await getVisitorChat(sid)).messages.at(-1)?.body).toBe("Chat is open again.");
  });

  it("keeps a private rejection open, blocks published candidate uploads before storage, and allows draft cleanup and admin attachments", async () => {
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "rejected" });
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Internal status is still private." });
    const draft = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: { name: "draft.png", type: "image/png", buffer: PNG } });
    await updateCandidateOutcome(lead.id, publish);
    const put = vi.spyOn(storage(), "put");
    try {
      await expect(uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: { name: "blocked.png", type: "image/png", buffer: PNG } }))
        .rejects.toMatchObject({ status: 403, code: "candidate_chat_closed" });
      expect(put).not.toHaveBeenCalled();
    } finally { put.mockRestore(); }
    await deletePendingFile(sid, draft.id);
    const adminAttachment = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "admin", file: { name: "admin.png", type: "image/png", buffer: PNG } });
    await postAdminMessage(lead.id, { clientMessageId: randomUUID(), body: "Administrative follow-up", fileIds: [adminAttachment.id] });
    const details = await getLeadDetails(lead.id);
    expect(details.messages.at(-1)?.files[0].id).toBe(adminAttachment.id);
    expect(details.messages.some((message) => message.body === "Internal status is still private.")).toBe(true);
    expect((await getVisitorChat(sid)).outcome).not.toBeNull();
  });

  it("clears a published result when changing the internal decision and never restarts a cancelled welcome message", async () => {
    const { sid, lead } = await candidate("legacy");
    await updateLeadStatus(lead.id, { status: "rejected" });
    await updateCandidateOutcome(lead.id, publish);
    await updateLeadStatus(lead.id, { status: "new" });
    expect((await getVisitorState(sid)).outcome).toBeNull();
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "A changed status reopened the chat." });
    await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: { name: "new-status.png", type: "image/png", buffer: PNG } });
    await updateLeadStatus(lead.id, { status: "rejected" });
    expect((await getVisitorChat(sid)).outcome).toBeNull();
    expect((await jobFor(sid)).status).toBe("cancelled");
  });

  it("serializes a concurrent candidate send with publication, then rejects every later send", async () => {
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "rejected" });
    const [published, sent] = await Promise.allSettled([
      updateCandidateOutcome(lead.id, publish),
      postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Concurrent message" }),
    ]);
    expect(published.status).toBe("fulfilled");
    if (sent.status === "rejected") expect(sent.reason).toMatchObject({ code: "candidate_chat_closed" });
    const chat = await getVisitorChat(sid);
    expect(chat.outcome).not.toBeNull();
    expect(chat.messages).toHaveLength(sent.status === "fulfilled" ? 2 : 1);
    expect(chat.messages[0].sender).toBe("system");
    await expect(postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "After publication" }))
      .rejects.toMatchObject({ status: 403, code: "candidate_chat_closed" });
    expect((await getVisitorChat(sid)).messages).toEqual(chat.messages);
  });

  it("rechecks a visitor upload after external storage and cleans the object if publication won the race", async () => {
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "rejected" });
    const original = storage();
    let startUpload!: () => void;
    let finishUpload!: () => void;
    const started = new Promise<void>((resolve) => { startUpload = resolve; });
    const finish = new Promise<void>((resolve) => { finishUpload = resolve; });
    let uploadedKey: string | null = null;
    setStorage({
      ...original,
      async put(key, data, type) {
        uploadedKey = key;
        await original.put(key, data, type);
        startUpload();
        await finish;
      },
    });
    try {
      const uploading = uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: { name: "during-publication.png", type: "image/png", buffer: PNG } });
      await started;
      await updateCandidateOutcome(lead.id, publish);
      finishUpload();
      await expect(uploading).rejects.toMatchObject({ status: 403, code: "candidate_chat_closed" });
      expect(uploadedKey).not.toBeNull();
      expect(env.blobs.has(uploadedKey!)).toBe(false);
      const rows = await env.db.select().from(schema.files).where(eq(schema.files.storageKey, uploadedKey!));
      expect(rows).toHaveLength(0);
    } finally {
      finishUpload();
      setStorage(original);
    }
  });

  it("serializes publication and due delivery so only an already delivered welcome can remain", async () => {
    const { sid, lead } = await candidate("legacy");
    const job = await jobFor(sid);
    await updateLeadStatus(lead.id, { status: "rejected" });
    await Promise.all([
      updateCandidateOutcome(lead.id, publish),
      deliverScheduledMessage(job.id, new Date(job.scheduledFor.getTime() + 1)),
    ]);
    const stored = await jobFor(sid);
    expect(["cancelled", "sent"]).toContain(stored.status);
    const messagesBefore = (await getVisitorChat(sid)).messages;
    expect(messagesBefore).toHaveLength(stored.status === "sent" ? 1 : 0);
    await deliverScheduledMessage(job.id, new Date(job.scheduledFor.getTime() + 5000));
    expect((await getVisitorChat(sid)).messages).toEqual(messagesBefore);
    expect((await getVisitorState(sid)).outcome).not.toBeNull();
  });

  it("rejects direct candidate message and attachment HTTP requests while keeping result polling available", async () => {
    const { sid, lead } = await candidate();
    const token = randomBytes(32).toString("base64url");
    await env.db.update(schema.visitorSessions).set({ tokenHash: createHash("sha256").update(token).digest("hex") })
      .where(eq(schema.visitorSessions.id, sid));
    jar.set("nl_visitor", token);
    const headers = { host: "example.com", origin: "https://example.com" };
    const messageRequest = () => new Request("https://example.com/api/chat", {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ clientMessageId: randomUUID(), body: "Direct HTTP message" }),
    });
    const uploadRequest = () => {
      const form = new FormData();
      form.set("purpose", "chat");
      form.set("file", new File([new Uint8Array(PNG)], "direct.png", { type: "image/png" }));
      return new Request("https://example.com/api/uploads", { method: "POST", headers, body: form });
    };
    try {
      await updateLeadStatus(lead.id, { status: "rejected" });
      await updateCandidateOutcome(lead.id, publish);
      const blockedMessage = await postChatRoute(messageRequest());
      expect(blockedMessage.status).toBe(403);
      expect(await blockedMessage.json()).toMatchObject({ code: "candidate_chat_closed" });
      const blockedUpload = await postUploadRoute(uploadRequest());
      expect(blockedUpload.status).toBe(403);
      expect(await blockedUpload.json()).toMatchObject({ code: "candidate_chat_closed" });
      const polling = await getChatRoute(new Request("https://example.com/api/chat", { headers }));
      expect(polling.status).toBe(200);
      expect((await polling.json()).outcome).not.toBeNull();
      await updateCandidateOutcome(lead.id, { action: "retract" });
      expect((await postChatRoute(messageRequest())).status).toBe(201);
      expect((await postUploadRoute(uploadRequest())).status).toBe(201);
    } finally { jar.delete("nl_visitor"); }
  });

  it("protects publishing and retraction with admin authentication and same-origin checks", async () => {
    jar.clear();
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "rejected" });
    const ctx = { params: Promise.resolve({ id: String(lead.id) }) };
    const request = (origin = "https://example.com", action: object = publish) => new Request(`https://example.com/api/admin/leads/${lead.id}/outcome`, {
      method: "POST", headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify(action),
    });
    expect((await POST(request(), ctx)).status).toBe(401);
    vi.stubEnv("ADMIN_SESSION_SECRET", "test-secret-with-more-than-thirty-two-characters");
    const [admin] = await env.db.insert(schema.adminUsers).values({ email: "outcome@example.com", passwordHash: "unused", tokenVersion: 0 }).returning();
    jar.set("nl_admin", await new SignJWT({ v: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id)
      .setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET!)));
    expect((await POST(request("https://attacker.example"), ctx)).status).toBe(403);
    expect((await getVisitorState(sid)).outcome).toBeNull();
    expect((await POST(request(), ctx)).status).toBe(200);
    expect((await getVisitorState(sid)).outcome).not.toBeNull();
    expect((await POST(request("https://attacker.example", { action: "retract" }), ctx)).status).toBe(403);
    expect((await POST(request("https://example.com", { action: "retract" }), ctx)).status).toBe(200);
    expect((await getVisitorState(sid)).outcome).toBeNull();
    jar.clear();
  });
});
