import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { normalizeRichTextContent, type RichTextDocument } from "@/lib/rich-text";
import { getQuickReplies, updateQuickReplies } from "@/server/services/quick-replies";
import { defaultQuickReplies } from "@/lib/quick-replies";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { getVisitorChat, loadMessagePage, postVisitorMessage } from "@/server/services/chat";
import { getLeadDetails, listLeads, postAdminMessage } from "@/server/services/admin";
import { changeAdminMessage } from "@/server/services/message-management";
import { updateSettings } from "@/server/settings";
import { defaultSettings } from "@/config/settings";
import { POST } from "@/app/api/admin/leads/[id]/messages/route";
import { PATCH, DELETE } from "@/app/api/admin/leads/[id]/messages/[messageId]/route";
import { PUT } from "@/app/api/admin/quick-replies/route";
import { newSession, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined }) }));
const secret = "rich-chat-test-secret-at-least-thirty-two-characters";
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let staff: typeof schema.adminUsers.$inferSelect;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  jar.clear(); vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  await env.db.delete(schema.visitorSessions); await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.appSettings); await env.db.delete(schema.rateLimits);
  env.blobs.clear(); env.queued.length = 0;
  await updateSettings({ ...defaultSettings, autoMessageEnabled: false });
  [staff] = await env.db.insert(schema.adminUsers).values({ email: "rich-staff@example.test", passwordHash: "unused", isTemporary: true }).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

const body = "Ważna wiadomość\nOtwórz Signal";
const rich: RichTextDocument = { version: 1, runs: [
  { text: "Ważna wiadomość", bold: true, underline: true }, { text: "\n" },
  { text: "Otwórz Signal", italic: true, href: "https://signal.me/#eu/test_ABC-123" },
] };
const format = (bold?: true, underline?: true): RichTextDocument => ({ version: 1, runs: [{ text: "Ten sam tekst", ...(bold ? { bold } : {}), ...(underline ? { underline } : {}) }] });
const request = (method: string, payload: unknown, origin = "https://example.com") => new Request("https://example.com/api/admin/leads/1/messages", {
  method, headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify(payload),
});
async function authenticate() {
  jar.set("nl_admin", await new SignJWT({ v: staff.tokenVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(staff.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
}
async function candidate() {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Test formatowania", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const image = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: { name: "test.png", type: "image/png", buffer: PNG } });
  await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [image.id], review: "Opis testowego zadania." });
  const [conversation] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
  return { sid, conversation, leadId: conversation.leadId! };
}
async function send(leadId: number, text = body, bodyRich: RichTextDocument | null = rich, clientMessageId: string = randomUUID()) {
  const messages = await postAdminMessage(leadId, { clientMessageId, body: text, bodyRich });
  return messages.find(message => message.clientMessageId === clientMessageId)!;
}

describe("rich templates and message storage", () => {
  it("preserves legacy template shapes and normalizes formatted text with a revision check", async () => {
    expect((await getQuickReplies()).replies).toEqual(defaultQuickReplies);
    const saved = await updateQuickReplies({ revision: null, replies: [{ id: "formatted", title: "Format", body: `  ${body}  `, bodyRich: { ...rich, runs: [{ text: "  " }, ...rich.runs, { text: "  " }] } }] });
    expect(saved.replies[0]).toEqual({ id: "formatted", title: "Format", body, bodyRich: rich });
    expect(await getQuickReplies()).toEqual(saved);
    await updateQuickReplies({ ...saved, replies: [{ ...saved.replies[0], bodyRich: null }] });
    await expect(updateQuickReplies(saved)).rejects.toMatchObject({ status: 409, code: "quick_replies_changed" });
    expect(await env.db.select().from(schema.messages)).toEqual([]);
  });

  it("persists formatting while preserving plain searchable text, Unicode, newlines and link fragments", async () => {
    const c = await candidate();
    const message = await send(c.leadId);
    expect(message).toMatchObject({ body, bodyRich: rich, sender: "admin", changeRevision: 0 });
    expect((await getVisitorChat(c.sid)).messages[0]).toMatchObject({ id: message.id, body, bodyRich: rich });
    expect((await getLeadDetails(c.leadId)).messages[0]).toMatchObject({ bodyRich: rich });
    const [stored] = await env.db.select().from(schema.messages).where(eq(schema.messages.id, message.id));
    expect(stored.body).toBe(body); expect(stored.bodyRich).toEqual(rich);
    expect(await env.db.select().from(schema.scheduledMessages)).toEqual([]);
    expect((await getLeadDetails(c.leadId)).lead.status).toBe("new");
  });

  it("deduplicates a canonical formatted send and refuses reusing its ID for other formatting", async () => {
    const c = await candidate(); const key = randomUUID();
    const message = await send(c.leadId, body, rich, key);
    // JSONB reorders object keys; equality must be structural, not JSON.stringify order.
    await send(c.leadId, body, { runs: rich.runs, version: 1 }, key);
    expect((await loadMessagePage(c.conversation.id)).messages).toHaveLength(1);
    await expect(send(c.leadId, body, null, key)).rejects.toMatchObject({ status: 409, code: "message_changed" });
    expect((await loadMessagePage(c.conversation.id)).messages[0].id).toBe(message.id);
  });

  it("keeps visitor messages plain and legacy administrator messages readable", async () => {
    const c = await candidate();
    const visitor = await postVisitorMessage(c.sid, { clientMessageId: randomUUID(), body, bodyRich: rich });
    expect(visitor.message.body).toBe(body); expect(visitor.message.bodyRich).toBeNull();
    const key = randomUUID();
    const legacy = (await postAdminMessage(c.leadId, { clientMessageId: key, body: "Legacy https://example.test/?a=1&b=2#fragment" })).find(message => message.clientMessageId === key)!;
    expect(legacy.bodyRich).toBeNull();
    expect((await loadMessagePage(c.conversation.id)).messages).toHaveLength(2);
  });

  it("rejects unsafe, mismatched, unsupported and oversized rich content before any message/template write", async () => {
    const c = await candidate();
    const invalid = [
      { version: 1, runs: [{ text: body, href: "javascript:alert(1)" }] },
      { version: 1, runs: [{ text: "Different text", bold: true }] },
      { version: 1, runs: [{ text: body, html: "<script>alert(1)</script>" }] },
      { version: 2, runs: [{ text: body }] },
      { version: 1, runs: Array.from({ length: 257 }, () => ({ text: "a" })) },
    ];
    for (const doc of invalid) {
      await expect(postAdminMessage(c.leadId, { clientMessageId: randomUUID(), body, bodyRich: doc })).rejects.toMatchObject({ name: "ZodError" });
      await expect(updateQuickReplies({ revision: null, replies: [{ id: "bad", title: "Bad", body, bodyRich: doc }] })).rejects.toMatchObject({ name: "ZodError" });
    }
    expect(await env.db.select().from(schema.messages)).toEqual([]);
    expect((await getQuickReplies()).revision).toBeNull();
  });

  it("uses the change cursor for format-only edits and detects format-only concurrency", async () => {
    const c = await candidate();
    await postVisitorMessage(c.sid, { clientMessageId: randomUUID(), body: "Pytanie" });
    const message = await send(c.leadId, "Ten sam tekst", null);
    const initial = await getVisitorChat(c.sid);
    const original = await getLeadDetails(c.leadId);
    const edited = await changeAdminMessage(c.leadId, message.id, "edit", { body: message.body, bodyRich: format(true), expectedBody: message.body, expectedChangeRevision: 0 });
    expect(edited).toMatchObject({ body: message.body, bodyRich: format(true), changeRevision: 1 });
    const update = await getVisitorChat(c.sid, { after: initial.nextCursor!, changesAfter: initial.changes.cursor });
    expect(update.messages).toEqual([]); expect(update.changes.updates[0]).toMatchObject({ id: message.id, bodyRich: format(true), changeRevision: 1 });
    expect(update.changes.updates[0].createdAt).toBe(message.createdAt);
    expect((await getLeadDetails(c.leadId)).lead.messageCount).toBe(original.lead.messageCount);
    expect((await listLeads({ queue: "needs_reply" })).total).toBe(0);
    await expect(changeAdminMessage(c.leadId, message.id, "edit", { body: message.body, bodyRich: format(undefined, true), expectedBody: message.body, expectedChangeRevision: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: message.body, expectedChangeRevision: 0 })).rejects.toMatchObject({ status: 409 });
    expect((await changeAdminMessage(c.leadId, message.id, "edit", { body: message.body, bodyRich: format(true), expectedBody: message.body, expectedChangeRevision: 0 })).changeRevision).toBe(1);
    const current = await getLeadDetails(c.leadId);
    expect(current.changes.updates).toEqual([]);
  });

  it("allows only one concurrent formatting edit and deletes both body representations", async () => {
    const c = await candidate(); const message = await send(c.leadId, "Ten sam tekst", null);
    const edits = await Promise.allSettled([format(true), format(undefined, true)].map(bodyRich => changeAdminMessage(c.leadId, message.id, "edit", {
      body: message.body, bodyRich, expectedBody: message.body, expectedChangeRevision: 0,
    })));
    expect(edits.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(edits.find(value => value.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const deleted = await changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: message.body, expectedChangeRevision: 1 });
    expect(deleted).toMatchObject({ body: "", bodyRich: null, deleted: true });
    const [stored] = await env.db.select().from(schema.messages).where(eq(schema.messages.id, message.id));
    expect(stored.body).toBe(""); expect(stored.bodyRich).toBeNull(); expect(stored.deletedAt).not.toBeNull();
    await send(c.leadId, "Ten sam tekst", null, message.clientMessageId);
    expect((await loadMessagePage(c.conversation.id)).messages).toEqual([]);
  });

  it("protects rich messages from cached clients without a revision while retaining plain-text compatibility", async () => {
    const c = await candidate(); const message = await send(c.leadId);
    await expect(changeAdminMessage(c.leadId, message.id, "edit", { body: "A cached plain edit", expectedBody: body })).rejects.toMatchObject({ status: 409, code: "message_changed" });
    await expect(changeAdminMessage(c.leadId, message.id, "delete", { expectedBody: body })).rejects.toMatchObject({ status: 409, code: "message_changed" });
    expect((await loadMessagePage(c.conversation.id)).messages[0]).toMatchObject({ body, bodyRich: rich, changeRevision: 0 });
    await changeAdminMessage(c.leadId, message.id, "edit", { body: "Now plain", bodyRich: null, expectedBody: body, expectedChangeRevision: 0 });
    // The existing legacy plain-text API remains valid after formatting is explicitly removed.
    const plain = await changeAdminMessage(c.leadId, message.id, "edit", { body: "Legacy edit still works", expectedBody: "Now plain" });
    expect(plain).toMatchObject({ body: "Legacy edit still works", bodyRich: null, changeRevision: 2 });
  });
});

describe("rich chat API boundaries", () => {
  it("gates content before reading it, preserves origin checks and returns formatted content to existing staff", async () => {
    const c = await candidate(); const ctx = { params: Promise.resolve({ id: String(c.leadId) }) };
    const payload = { clientMessageId: randomUUID(), body, bodyRich: rich };
    const denied = request("POST", payload);
    expect((await POST(denied, ctx)).status).toBe(401); expect(denied.bodyUsed).toBe(false);
    await authenticate();
    expect((await POST(request("POST", payload, "https://other.example"), ctx)).status).toBe(403);
    const sent = await POST(request("POST", payload), ctx);
    expect(sent.status).toBe(201); expect(sent.headers.get("cache-control")).toBe("no-store");
    const [message] = (await sent.json()).messages;
    expect(message.bodyRich).toEqual(rich);
    const messageCtx = { params: Promise.resolve({ id: String(c.leadId), messageId: message.id }) };
    const changed = await PATCH(request("PATCH", { body, bodyRich: null, expectedBody: body, expectedChangeRevision: 0 }), messageCtx);
    expect(changed.status).toBe(200); expect((await changed.json()).bodyRich).toBeNull();
    expect((await DELETE(request("DELETE", { expectedBody: body, expectedChangeRevision: 0 }), messageCtx)).status).toBe(409);
  });

  it("supports the bounded complete template set without truncating metadata", async () => {
    await authenticate();
    const longHref = `https://example.test/${"a".repeat(1200)}`;
    // Every reply uses the full 2000-character body with three-byte UTF-8 text and a
    // valid rich document near its 16KB limit. All 12 legitimate replies exceed 256KB.
    const largeRich: RichTextDocument = { version: 1, runs: Array.from({ length: 8 }, (_, i) => ({ text: "漢".repeat(250), href: `${longHref}/${i}` })) };
    const text = largeRich.runs.map(run => run.text).join("");
    const replies = Array.from({ length: 12 }, (_, index) => ({ id: `large-${index}`, title: `Template ${index}`, body: text, bodyRich: largeRich }));
    const payload = { revision: null, replies };
    expect(text).toHaveLength(2000);
    expect(Buffer.byteLength(JSON.stringify(largeRich))).toBeLessThanOrEqual(16 * 1024);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(256 * 1024);
    const response = await PUT(request("PUT", payload));
    expect(response.status).toBe(200);
    expect((await response.json()).replies[11].bodyRich).toEqual(normalizeRichTextContent(text, largeRich, 2000).bodyRich);
    expect((await getQuickReplies()).replies).toHaveLength(12);
    const oversized = new Request("https://example.com/api/admin/quick-replies", { method: "PUT", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json" }, body: "x".repeat(384 * 1024 + 1) });
    expect((await PUT(oversized)).status).toBe(413);
  });

  it("keeps failed rich message/template values out of database error diagnostics", async () => {
    const c = await candidate(); await authenticate();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.client.exec("CREATE FUNCTION fail_rich_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary write failure'; END $$; CREATE TRIGGER fail_rich_message BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION fail_rich_write(); CREATE TRIGGER fail_rich_template BEFORE INSERT ON app_settings FOR EACH ROW EXECUTE FUNCTION fail_rich_write();");
    try {
      const response = await POST(request("POST", { clientMessageId: randomUUID(), body, bodyRich: rich }), { params: Promise.resolve({ id: String(c.leadId) }) });
      expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ code: "message_send_failed" });
      const templates = await PUT(request("PUT", { revision: null, replies: [{ id: "private", title: "Private", body, bodyRich: rich }] }));
      expect(templates.status).toBe(500); expect(await templates.json()).toMatchObject({ code: "quick_replies_save_failed" });
      expect(warning.mock.calls).toEqual([["messages.send_failed"], ["quick_replies.save_failed"]]);
      expect(errorLog).not.toHaveBeenCalled();
      expect(await env.db.select().from(schema.messages)).toEqual([]);
    } finally {
      await env.client.exec("DROP TRIGGER fail_rich_message ON messages; DROP TRIGGER fail_rich_template ON app_settings; DROP FUNCTION fail_rich_write();");
      warning.mockRestore(); errorLog.mockRestore();
    }
  });
});
