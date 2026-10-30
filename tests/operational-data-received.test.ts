import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { PATCH } from "@/app/api/admin/leads/[id]/route";
import { saveContact } from "@/server/services/contact";
import { getVisitorState, saveAnswer } from "@/server/services/quiz";
import { getLeadDetails, listLeads, updateLeadStatus } from "@/server/services/admin";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { newSession, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));
const secret = "operational-data-received-test-secret-with-32-characters";
const request = (id: number, status = "data_received", origin = "https://example.com") => new Request(`https://example.com/api/admin/leads/${id}`, {
  method: "PATCH", headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify({ status }),
});
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
let env: Awaited<ReturnType<typeof setupTestEnv>>;

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  jar.clear(); env.blobs.clear(); env.queued.length = 0;
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.appSettings);
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

async function candidate() {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Received data test", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  return { sid, lead };
}

describe("received-data handling status", () => {
  it("is saved and filtered through the normal lead API for both permanent and temporary administrators", async () => {
    const { sid, lead } = await candidate();
    expect((await PATCH(request(lead.id), context(lead.id))).status).toBe(401);
    for (const isTemporary of [false, true]) {
      const [admin] = await env.db.insert(schema.adminUsers).values({ email: `${isTemporary ? "manager" : "owner"}@example.com`, passwordHash: "unused", isTemporary }).returning();
      jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
        .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
      await updateLeadStatus(lead.id, { status: "in_progress" });
      expect((await PATCH(request(lead.id, "data_received", "https://attacker.example"), context(lead.id))).status).toBe(403);
      const response = await PATCH(request(lead.id), context(lead.id));
      expect(response.status).toBe(200);
      expect((await response.json()).lead.status).toBe("data_received");
      expect((await getLeadDetails(lead.id)).lead.status).toBe("data_received");
      expect((await listLeads({ status: "data_received" })).items.map(item => item.id)).toEqual([lead.id]);
      expect((await listLeads({ status: "in_progress" })).items).toEqual([]);
    }
    expect((await PATCH(request(lead.id, "unknown"), context(lead.id))).status).toBe(400);
    expect((await getVisitorState(sid)).outcome).toBeNull();
    // Ordinary handling does not create or modify the owner's separate reporting result.
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
  });

  it("keeps unfinished and needs-reply queues and the candidate conversation open", async () => {
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "data_received" });
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Dodatkowe pytanie" });
    await env.db.update(schema.visitorSessions).set({ lastSeenAt: new Date(Date.now() - 60 * 60_000) }).where(eq(schema.visitorSessions.id, sid));
    expect((await listLeads({ queue: "needs_reply", status: "data_received" })).items[0]).toMatchObject({ id: lead.id, needsReply: true });
    expect((await listLeads({ queue: "unfinished", status: "data_received" })).items[0]).toMatchObject({ id: lead.id, isUnfinished: true, stage: "task" });
    const chat = await getVisitorChat(sid);
    expect(chat.outcome).toBeNull();
    expect(chat.messages[0].body).toBe("Dodatkowe pytanie");
    expect((await getVisitorState(sid)).submission).toBeNull();
  });

  it("does not cancel the existing automatic acknowledgement or mark hiring successful", async () => {
    const { sid, lead } = await candidate();
    const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: { name: "shot.png", type: "image/png", buffer: PNG } });
    const submitted = await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis wykonanego zadania testowego." });
    const [before] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.submissionId, submitted.submissionId));
    expect(before).toMatchObject({ status: "sent", messageId: submitted.acknowledgement?.id });
    const messages = (await getVisitorChat(sid)).messages;
    expect(messages.map(message => message.sender)).toEqual(["system"]);
    await updateLeadStatus(lead.id, { status: "data_received" });
    const [after] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, before.id));
    expect(after).toEqual(before);
    expect(await deliverScheduledMessage(before.id, new Date(before.scheduledFor.getTime() + 1000))).toBe("already_sent");
    expect((await getVisitorChat(sid)).messages).toEqual(messages);
    expect((await getLeadDetails(lead.id)).lead).toMatchObject({ status: "data_received", outcome: null });
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
  });

  it("upgrades existing enum values without changing any legacy lead rows", async () => {
    const db = new PGlite();
    try {
      const journal = JSON.parse(await readFile(path.join(__dirname, "../drizzle/meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
      for (const entry of journal.entries.filter(entry => entry.idx < 15)) {
        await db.exec(await readFile(path.join(__dirname, `../drizzle/${entry.tag}.sql`), "utf8"));
      }
      const statuses = ["new", "in_progress", "awaiting_reply", "completed", "rejected"];
      for (const status of statuses) {
        const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ($1) returning id", [`legacy-${status}`]);
        await db.query("insert into leads(session_id,status) values ($1,$2)", [session.id, status]);
      }
      const before = await db.query("select * from leads order by id");
      await db.exec(await readFile(path.join(__dirname, "../drizzle/0015_operational_data_received.sql"), "utf8"));
      expect((await db.query("select * from leads order by id")).rows).toEqual(before.rows);
      await db.query("update leads set status='data_received' where id=1");
      expect((await db.query<{ status: string }>("select status from leads where id=1")).rows[0].status).toBe("data_received");
      await expect(db.query("update leads set status='unknown' where id=1")).rejects.toThrow();
    } finally { await db.close(); }
  });
});
