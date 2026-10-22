import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { uploadFile, getReadableFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { getVisitorChat, loadMessagePage, postVisitorMessage } from "@/server/services/chat";
import { getLeadDetails, listLeads, postAdminMessage } from "@/server/services/admin";
import { changeAdminMessage, purgeDeletedMessageFiles } from "@/server/services/message-management";
import { updateSettings } from "@/server/settings";
import { defaultSettings } from "@/config/settings";
import { storage } from "@/server/storage";
import { mergeMessages, reconcileMessageChanges, rememberMessageChanges } from "@/lib/chat";
import type { ChatMessage } from "@/lib/api";
import { PATCH, DELETE } from "@/app/api/admin/leads/[id]/messages/[messageId]/route";
import { newSession, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined }) }));
const secret = "message-management-test-secret-at-least-thirty-two-characters";
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let admin: typeof schema.adminUsers.$inferSelect;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  jar.clear(); vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  await env.db.delete(schema.visitorSessions); await env.db.delete(schema.adminUsers); await env.db.delete(schema.rateLimits);
  env.blobs.clear();
  await updateSettings({ ...defaultSettings, autoMessageEnabled: false });
  [admin] = await env.db.insert(schema.adminUsers).values({ email: "staff@example.test", passwordHash: "unused", isTemporary: true }).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });
async function candidate() {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Jan Testowy", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: { name: "test.png", type: "image/png", buffer: PNG } });
  await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis wykonanego zadania testowego." });
  const [conversation] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
  return { sid, conversation, leadId: conversation.leadId! };
}
async function reply(leadId: number, body = "Pierwotna wiadomość") {
  const clientMessageId = randomUUID();
  const messages = await postAdminMessage(leadId, { clientMessageId, body });
  return messages.find(message => message.clientMessageId === clientMessageId)!;
}

describe("administrator message changes", () => {
  it("edits in place and synchronizes through a separate cursor without a new-message notification", async () => {
    const c = await candidate();
    await postVisitorMessage(c.sid, { clientMessageId: randomUUID(), body: "Pytanie" });
    const message = await reply(c.leadId);
    const initial = await getVisitorChat(c.sid);
    await changeAdminMessage(c.leadId, message.id, "edit", { body: "  Poprawiona wiadomość  ", expectedBody: message.body });
    const update = await getVisitorChat(c.sid, { after: initial.nextCursor!, changesAfter: initial.changes.cursor });
    expect(update.messages).toEqual([]);
    expect(update.nextCursor).toBe(initial.nextCursor);
    expect(update.changes.updates).toHaveLength(1);
    expect(update.changes.updates[0]).toMatchObject({ id: message.id, sequence: message.sequence, createdAt: message.createdAt, body: "Poprawiona wiadomość", changeRevision: 1 });
    expect(update.changes.updates[0]).not.toHaveProperty("editedAt");
    expect(update.changes.updates[0]).not.toHaveProperty("deletedAt");
    expect((await getLeadDetails(c.leadId, "0")).changes.updates[0].body).toBe("Poprawiona wiadomość");
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
    expect((await getLeadDetails(c.leadId)).lead.messageCount).toBe(2);
  });

  it("deletes silently, removes stored text, updates counters, reopens the reply queue and keeps retries deleted", async () => {
    const c = await candidate();
    await postVisitorMessage(c.sid, { clientMessageId: randomUUID(), body: "Pytanie bez odpowiedzi" });
    const message = await reply(c.leadId);
    const initial = await getVisitorChat(c.sid);
    const deleted = await changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: message.body });
    expect(deleted.deleted).toBe(true);
    const update = await getVisitorChat(c.sid, { after: initial.nextCursor!, changesAfter: initial.changes.cursor });
    expect(update.messages).toEqual([]);
    expect(update.changes.updates).toEqual([]);
    expect(update.changes.deletedIds).toEqual([message.id]);
    expect((await getVisitorChat(c.sid)).messages.map(item => item.id)).not.toContain(message.id);
    expect((await getLeadDetails(c.leadId)).lead.messageCount).toBe(1);
    expect((await listLeads({ queue: "needs_reply" })).items[0].id).toBe(c.leadId);
    const [stored] = await env.db.select().from(schema.messages).where(eq(schema.messages.id, message.id));
    expect(stored.body).toBe(""); expect(stored.deletedAt).not.toBeNull();
    await postAdminMessage(c.leadId, { clientMessageId: message.clientMessageId, body: message.body });
    expect((await getVisitorChat(c.sid)).messages.map(item => item.id)).not.toContain(message.id);
    expect((await changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: message.body })).changeRevision).toBe(1);
  });

  it("preserves attachments on text edits and revokes file URLs immediately on deletion, even if storage cleanup fails", async () => {
    const c = await candidate();
    const file = await uploadFile({ sessionId: c.sid, purpose: "chat", uploadedBy: "admin", file: { name: "test.png", type: "image/png", buffer: PNG } });
    const messages = await postAdminMessage(c.leadId, { clientMessageId: randomUUID(), body: "Załącznik", fileIds: [file.id] });
    const message = messages.at(-1)!;
    await changeAdminMessage(c.leadId, message.id, "edit", { body: "", expectedBody: message.body });
    expect((await getVisitorChat(c.sid)).messages[0].files[0].id).toBe(file.id);
    const failure = vi.spyOn(storage(), "delete").mockRejectedValueOnce(new Error("temporary storage failure"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: "" });
      expect(await getReadableFile(file.id, { sessionId: c.sid })).toBeNull();
      expect(await getReadableFile(file.id, { admin: true })).toBeNull();
      expect(warn).toHaveBeenCalledExactlyOnceWith("messages.attachment_cleanup_pending");
      expect(await purgeDeletedMessageFiles()).toEqual({ deleted: 1, pending: 0 });
      expect(await env.db.select().from(schema.files).where(eq(schema.files.id, file.id))).toEqual([]);
    } finally { failure.mockRestore(); warn.mockRestore(); }
  });

  it("refuses visitor/system messages, cross-lead IDs, empty edits, stale edits and edits after deletion", async () => {
    const c = await candidate(); const other = await candidate();
    const visitor = await postVisitorMessage(c.sid, { clientMessageId: randomUUID(), body: "Visitor text" });
    const [system] = await env.db.insert(schema.messages).values({ conversationId: c.conversation.id, sender: "system", body: "System text", clientMessageId: randomUUID() }).returning();
    for (const message of [{ id: visitor.message.id, body: visitor.message.body }, system]) {
      await expect(changeAdminMessage(c.leadId, message.id, "edit", { body: "Changed", expectedBody: message.body })).rejects.toMatchObject({ status: 403 });
      await expect(changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: message.body })).rejects.toMatchObject({ status: 403 });
    }
    const message = await reply(c.leadId);
    await expect(changeAdminMessage(other.leadId, message.id, "delete", { expectedBody: message.body })).rejects.toMatchObject({ status: 404 });
    await expect(changeAdminMessage(c.leadId, "not-a-uuid", "delete", { expectedBody: message.body })).rejects.toMatchObject({ status: 404 });
    await expect(changeAdminMessage(c.leadId, message.id, "edit", { body: "  ", expectedBody: message.body })).rejects.toMatchObject({ status: 400 });
    await changeAdminMessage(c.leadId, message.id, "edit", { body: "New text", expectedBody: message.body });
    await expect(changeAdminMessage(c.leadId, message.id, "edit", { body: "Stale edit", expectedBody: message.body })).rejects.toMatchObject({ status: 409, code: "message_changed" });
    await expect(changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: message.body })).rejects.toMatchObject({ status: 409 });
    expect((await changeAdminMessage(c.leadId, message.id, "edit", { body: "New text", expectedBody: message.body })).changeRevision).toBe(1);
    await changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: "New text" });
    await expect(changeAdminMessage(c.leadId, message.id, "edit", { body: "Restore", expectedBody: "" })).rejects.toMatchObject({ status: 409 });
  });

  it("protects concurrent edits from overwriting each other", async () => {
    const c = await candidate(); const message = await reply(c.leadId);
    const results = await Promise.allSettled(["First edit", "Second edit"].map(body => changeAdminMessage(c.leadId, message.id, "edit", { body, expectedBody: message.body })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  });

  it("synchronizes old history with bounded change pages and does not resurrect stale history responses", async () => {
    const c = await candidate();
    const stored = await env.db.insert(schema.messages).values(Array.from({ length: 125 }, (_, index) => ({ conversationId: c.conversation.id, sender: "admin" as const, body: `History ${index}`, clientMessageId: randomUUID() }))).returning();
    const initial = await getVisitorChat(c.sid);
    const oldPage = await loadMessagePage(c.conversation.id, { before: initial.previousCursor! });
    for (const message of stored.slice(0, 110)) {
      await changeAdminMessage(c.leadId, message.id, Number(message.sequence) % 2 ? "edit" : "delete", { expectedBody: message.body, ...(Number(message.sequence) % 2 ? { body: "Updated history" } : {}) });
    }
    let cursor = initial.changes.cursor;
    let more = true;
    const cache = new Map<string, ChatMessage | null>();
    const seen = new Set<string>();
    while (more) {
      const response = await getVisitorChat(c.sid, { after: initial.nextCursor!, changesAfter: cursor });
      expect(response.messages).toEqual([]);
      expect(response.changes.updates.length + response.changes.deletedIds.length).toBeLessThanOrEqual(100);
      for (const id of [...response.changes.updates.map(item => item.id), ...response.changes.deletedIds]) { expect(seen.has(id)).toBe(false); seen.add(id); }
      rememberMessageChanges(cache, response.changes.updates, response.changes.deletedIds);
      cursor = response.changes.cursor; more = response.changes.hasMore;
    }
    expect(seen.size).toBe(110);
    const stale = reconcileMessageChanges(mergeMessages(oldPage.messages, oldPage.messages), cache);
    expect(stale.every(message => message.body === "Updated history")).toBe(true);
    expect(stale.every(message => cache.get(message.id) !== null)).toBe(true);
    expect(stale.some(message => message.body.startsWith("History"))).toBe(false);
  });
});

describe("message management API", () => {
  async function authenticate() {
    jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
  }
  const request = (method: "PATCH" | "DELETE", body: unknown, origin = "https://example.com") => new Request("https://example.com/api/admin/leads/1/messages/test", { method, headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  it("requires authentication and same-origin, permits existing staff, and rejects cross-lead access", async () => {
    const c = await candidate(); const other = await candidate(); const message = await reply(c.leadId);
    const ctx = { params: Promise.resolve({ id: String(c.leadId), messageId: message.id }) };
    const body = { body: "Edited through API", expectedBody: message.body };
    const denied = request("PATCH", body);
    expect((await PATCH(denied, ctx)).status).toBe(401); expect(denied.bodyUsed).toBe(false);
    await authenticate();
    expect((await PATCH(request("PATCH", body, "https://other.example"), ctx)).status).toBe(403);
    const saved = await PATCH(request("PATCH", body), ctx);
    expect(saved.status).toBe(200); expect(saved.headers.get("cache-control")).toBe("no-store");
    expect((await saved.json()).body).toBe("Edited through API");
    expect((await DELETE(request("DELETE", { expectedBody: "Edited through API" }), { params: Promise.resolve({ id: String(other.leadId), messageId: message.id }) })).status).toBe(404);
    expect((await DELETE(request("DELETE", { expectedBody: "Edited through API" }), ctx)).status).toBe(200);
    const visible = await env.db.select().from(schema.messages).where(and(eq(schema.messages.id, message.id)));
    expect(visible[0].body).toBe("");
  });

  it("rolls back failed edits and keeps message contents out of route diagnostics", async () => {
    const c = await candidate(); const message = await reply(c.leadId);
    await authenticate();
    await env.client.exec("CREATE FUNCTION reject_message_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary database failure'; END $$; CREATE TRIGGER reject_message_edit BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION reject_message_edit();");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await PATCH(request("PATCH", { body: "Private updated text", expectedBody: message.body }), { params: Promise.resolve({ id: String(c.leadId), messageId: message.id }) });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "message_change_failed" });
      expect(warn).toHaveBeenCalledExactlyOnceWith("messages.change_failed");
      expect(errorLog).not.toHaveBeenCalled();
      const [conversation] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.id, c.conversation.id));
      expect(conversation.messageRevision).toBe(0);
      expect((await loadMessagePage(c.conversation.id)).messages[0].body).toBe(message.body);
    } finally {
      await env.client.exec("DROP TRIGGER reject_message_edit ON messages; DROP FUNCTION reject_message_edit();");
      warn.mockRestore(); errorLog.mockRestore();
    }
  });
});
