import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { setupTestEnv, newSession, PNG, createLegacyScheduledSubmission } from "./helpers";
import { schema } from "@/db";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { uploadFile, deletePendingFile, getReadableFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { getVisitorChat, postVisitorMessage, loadMessagePage } from "@/server/services/chat";
import { deliverOverdue, deliverScheduledMessage } from "@/server/services/delivery";
import { requestTestimonial } from "@/server/services/testimonials";
import { getLeadDetails, postAdminMessage } from "@/server/services/admin";
import { chatConfig, uploadConfig } from "@/config/settings";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.client.close(); });
const image = { name: "test.png", type: "image/png", buffer: PNG };
async function visitor(legacy = false) {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Test", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: image });
  const input = { idempotencyKey: randomUUID(), fileIds: [f.id], review: "A meaningful review" };
  if (legacy) await createLegacyScheduledSubmission(sid, input);
  else await submitTask(sid, input);
  const [conv] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
  return { sid, conv };
}
async function history(conversationId: string, count: number) {
  const at = new Date();
  return env.db.insert(schema.messages).values(Array.from({ length: count }, (_, i) => ({
    conversationId, sender: "admin" as const, body: `History ${i}`, clientMessageId: randomUUID(), createdAt: at,
  }))).returning();
}

describe("chat regression cases", () => {
  it("loads the newest messages and paginates all older history, including equal timestamps", async () => {
    const { sid, conv } = await visitor();
    const acknowledgement = (await getVisitorChat(sid)).messages;
    expect(acknowledgement.map(message => message.sender)).toEqual(["system"]);
    const stored = await history(conv.id, 605);
    let page = await getVisitorChat(sid);
    expect(page.messages).toHaveLength(chatConfig.pageSize);
    expect(page.messages.at(-1)?.id).toBe(stored.at(-1)?.id);
    const ids = new Set(page.messages.map(m => m.id));
    while (page.hasMore) {
      page = await getVisitorChat(sid, { before: page.previousCursor! });
      page.messages.forEach(m => { expect(ids.has(m.id)).toBe(false); ids.add(m.id); });
    }
    expect(ids.size).toBe(605 + acknowledgement.length);
    expect(ids.has(acknowledgement[0].id)).toBe(true);
    const sent = await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Latest visitor reply" });
    expect(sent.message.body).toBe("Latest visitor reply");
    const admin = await postAdminMessage(conv.leadId!, { clientMessageId: randomUUID(), body: "Latest admin reply" });
    expect(admin.at(-1)?.body).toBe("Latest admin reply");
    expect((await getLeadDetails(conv.leadId!)).hasEarlierMessages).toBe(true);
  });

  it("receives an unseen manager reply even after the visitor has sent another message", async () => {
    const { sid, conv } = await visitor();
    await history(conv.id, 1);
    const cursor = (await getVisitorChat(sid)).nextCursor!;
    const [incoming] = await history(conv.id, 1);
    const outgoing = await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Sent before polling" });
    const page = await getVisitorChat(sid, { after: cursor });
    expect(page.messages.map(m => m.id)).toEqual([incoming.id, outgoing.message.id]);
  });

  it("drains more than one page of new messages without skips", async () => {
    const { conv } = await visitor();
    const [first] = await history(conv.id, 1);
    await history(conv.id, 250);
    let cursor = first.sequence.toString();
    const ids = new Set<string>();
    let more = true;
    while (more) {
      const page = await loadMessagePage(conv.id, { after: cursor });
      page.messages.forEach(m => ids.add(m.id));
      cursor = page.nextCursor!;
      more = page.hasMore;
    }
    expect(ids.size).toBe(250);
    expect((await loadMessagePage(conv.id, { after: cursor })).messages).toEqual([]);
  });

  it("rejects invalid and conflicting cursors", async () => {
    const { conv } = await visitor();
    for (const after of ["NaN", "", "0", "-1", "1.2", "9999999999999999999"])
      await expect(loadMessagePage(conv.id, { after })).rejects.toMatchObject({ name: "ZodError" });
    await expect(loadMessagePage(conv.id, { after: "1", before: "2" })).rejects.toThrow();
  });
});

describe("transaction and recovery regression cases", () => {
  it("the backup sweep reclaims expired sending jobs and does not steal a fresh lock", async () => {
    const { conv } = await visitor(true);
    const [job] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.conversationId, conv.id));
    const old = new Date(Date.now() - 10 * 60_000);
    await env.db.update(schema.scheduledMessages).set({ status: "sending", scheduledFor: old, lockedAt: new Date() }).where(eq(schema.scheduledMessages.id, job.id));
    expect(await deliverScheduledMessage(job.id)).toBe("busy");
    expect((await deliverOverdue({ conversationId: conv.id }))[job.id]).toBeUndefined();
    await env.db.update(schema.scheduledMessages).set({ lockedAt: old }).where(eq(schema.scheduledMessages.id, job.id));
    expect((await deliverOverdue({ conversationId: conv.id }))[job.id]).toBe("sent");
    expect(await deliverScheduledMessage(job.id)).toBe("already_sent");
  });

  it("a failed invitation rolls back both the unlock and message and can be retried", async () => {
    const { conv } = await visitor();
    await env.client.exec(`CREATE FUNCTION reject_audit_invitation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.client_message_id LIKE 'testimonial-request:%' THEN RAISE EXCEPTION 'temporary failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER reject_audit_invitation BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION reject_audit_invitation();`);
    try { await expect(requestTestimonial(conv.leadId!)).rejects.toThrow(); }
    finally { await env.client.exec("DROP TRIGGER reject_audit_invitation ON messages; DROP FUNCTION reject_audit_invitation();"); }
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.id, conv.leadId!));
    expect(lead.testimonialRequestedAt).toBeNull();
    expect((await requestTestimonial(conv.leadId!)).alreadyRequested).toBe(false);
    expect((await requestTestimonial(conv.leadId!)).alreadyRequested).toBe(true);
    const messages = await env.db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, conv.id), eq(schema.messages.clientMessageId, `testimonial-request:${conv.leadId}`)));
    expect(messages).toHaveLength(1);
  });

  it("parallel uploads cannot exceed the submission limit or leak rejected blobs", async () => {
    const sid = await newSession(env.db);
    const upload = () => uploadFile({ sessionId: sid, purpose: "submission" as const, uploadedBy: "visitor" as const, file: image });
    for (let i = 0; i < uploadConfig.maxFilesPerSubmission - 1; i++) await upload();
    const count = env.blobs.size;
    const results = await Promise.allSettled([upload(), upload()]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await env.db.select().from(schema.files).where(eq(schema.files.sessionId, sid))).toHaveLength(uploadConfig.maxFilesPerSubmission);
    expect(env.blobs.size).toBe(count + 1);
  });

  it("sent files cannot be deleted, and malformed IDs are handled as not found", async () => {
    const { sid } = await visitor();
    const [f] = await env.db.select().from(schema.files).where(eq(schema.files.sessionId, sid));
    await expect(deletePendingFile(sid, f.id)).rejects.toThrow();
    await expect(deletePendingFile(sid, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
    expect(await getReadableFile("------------------------------------", { sessionId: sid })).toBeNull();
  });

  it("administrator draft deletion enforces its owner and releases storage", async () => {
    const { sid } = await visitor();
    const f = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "admin", file: image });
    await expect(deletePendingFile(sid, f.id)).rejects.toThrow();
    await deletePendingFile(sid, f.id, "admin");
    expect(await getReadableFile(f.id, { admin: true })).toBeNull();
  });
});
