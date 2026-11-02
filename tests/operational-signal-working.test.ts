import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { GET as listGET } from "@/app/api/admin/leads/route";
import { PATCH } from "@/app/api/admin/leads/[id]/route";
import { GET as privateResultGET, PATCH as privateResultPATCH } from "@/app/api/admin/leads/[id]/result/route";
import { saveContact } from "@/server/services/contact";
import { getVisitorState, saveAnswer } from "@/server/services/quiz";
import { getLeadDetails, listLeads, updateLeadStatus } from "@/server/services/admin";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { getLeadResult, getLeadResults, getLeadResultsSuccesses, updateLeadResult } from "@/server/services/lead-results";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { newSession, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));
const secret = "operational-signal-working-test-secret-with-32-characters";
const request = (id: number, status = "signal_working", origin = "https://example.com") => new Request(`https://example.com/api/admin/leads/${id}`, {
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
  await env.db.delete(schema.rateLimits);
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

async function candidate() {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Signal success test", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  return { sid, lead };
}
async function authenticate(isTemporary: boolean) {
  const [admin] = await env.db.insert(schema.adminUsers).values({
    email: `${isTemporary ? "manager" : "owner"}@example.test`, passwordHash: "unused", isTemporary,
  }).returning();
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
  return admin;
}

describe("ordinary Signal success status", () => {
  it("lets main and temporary admins save and filter it through the normal authenticated APIs", async () => {
    const { sid, lead } = await candidate();
    expect((await PATCH(request(lead.id), context(lead.id))).status).toBe(401);
    for (const isTemporary of [false, true]) {
      await authenticate(isTemporary);
      await updateLeadStatus(lead.id, { status: "data_received" });
      expect((await PATCH(request(lead.id, "signal_working", "https://attacker.example"), context(lead.id))).status).toBe(403);
      expect((await getLeadDetails(lead.id)).lead.status).toBe("data_received");
      const response = await PATCH(request(lead.id), context(lead.id));
      expect(response.status).toBe(200);
      expect((await response.json()).lead).toMatchObject({ status: "signal_working", outcome: null });
      const filtered = await listGET(new Request("https://example.com/api/admin/leads?status=signal_working"));
      expect(filtered.status).toBe(200);
      expect((await filtered.json()).items.map((item: { id: number }) => item.id)).toEqual([lead.id]);
      expect((await listLeads({ status: "data_received" })).items).toEqual([]);
    }
    expect((await PATCH(request(lead.id, "unknown"), context(lead.id))).status).toBe(400);
    expect((await getVisitorState(sid)).outcome).toBeNull();
    expect((await getLeadResult(lead.id)).result).toMatchObject({ qualification: "suitable", closure: "signal_working" });
    const report = await getLeadResults({ period: "7d" });
    expect(report.totals).toMatchObject({ leads: 1, success: 1, suitable: 1, reviewed: 1 });
    expect(report.daily.reduce((sum, day) => sum + day.success, 0)).toBe(1);
    expect((await getLeadResultsSuccesses({ period: "7d" })).leads.items.map(item => item.id)).toEqual([lead.id]);
  });

  it("removes successful leads from unfinished counts and badges while preserving replies and chat", async () => {
    const { sid, lead } = await candidate();
    await env.db.update(schema.visitorSessions).set({ lastSeenAt: new Date(Date.now() - 60 * 60_000) }).where(eq(schema.visitorSessions.id, sid));
    expect((await listLeads({ queue: "unfinished" })).unfinishedCount).toBe(1);
    await updateLeadStatus(lead.id, { status: "signal_working" });
    const all = await listLeads({});
    expect(all.items[0]).toMatchObject({ id: lead.id, isUnfinished: false, status: "signal_working", stage: "task" });
    expect(all.unfinishedCount).toBe(0);
    expect((await listLeads({ queue: "unfinished", inactiveMinutes: "0" })).items).toEqual([]);
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Dodatkowe pytanie" });
    expect((await listLeads({ queue: "needs_reply", status: "signal_working" })).items[0]).toMatchObject({ id: lead.id, needsReply: true });
    const chat = await getVisitorChat(sid);
    expect(chat.outcome).toBeNull();
    expect(chat.messages[0].body).toBe("Dodatkowe pytanie");
    expect((await getVisitorState(sid)).submission).toBeNull();
    await updateLeadStatus(lead.id, { status: "in_progress" });
    expect((await listLeads({ queue: "unfinished", inactiveMinutes: "0" })).items.map(item => item.id)).toEqual([lead.id]);
  });

  it("updates results through the shared selector while protecting private notes, task, acknowledgement and candidate outcome", async () => {
    const { sid, lead } = await candidate();
    const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: { name: "shot.png", type: "image/png", buffer: PNG } });
    await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis wykonanego zadania testowego." });
    const before = await getVisitorState(sid);
    const messages = (await getVisitorChat(sid)).messages;
    const jobs = await env.db.select().from(schema.scheduledMessages);
    const owner = await authenticate(false);
    await updateLeadResult(lead.id, owner.id, {
      reason: null, comment: "PRIVATE_OWNER_REVIEW",
      responsibleAdminId: owner.id, expectedVersion: 0,
    });
    const privateBefore = await env.db.select().from(schema.leadResults);
    const historyBefore = await env.db.select().from(schema.leadResultHistory);
    await authenticate(true);
    const response = await PATCH(request(lead.id), context(lead.id));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("PRIVATE_OWNER_REVIEW");
    expect((await privateResultGET(new Request(`https://example.com/api/admin/leads/${lead.id}/result`), context(lead.id))).status).toBe(403);
    expect(JSON.stringify(await listLeads({ status: "signal_working" }))).not.toContain("PRIVATE_OWNER_REVIEW");
    const privateAfter = await getLeadResult(lead.id);
    expect(privateAfter.result).toMatchObject({ comment: privateBefore[0].comment,
      reason: privateBefore[0].reason, responsibleAdminId: privateBefore[0].responsibleAdminId,
      qualification: "suitable", closure: "signal_working" });
    expect(privateAfter.history.length).toBe(historyBefore.length + 1);
    const after = await getVisitorState(sid);
    expect(after.submission).toEqual(before.submission);
    expect(after.outcome).toBeNull();
    expect((await getVisitorChat(sid)).messages).toEqual(messages);
    expect(await env.db.select().from(schema.scheduledMessages)).toEqual(jobs);
    expect((await listLeads({ queue: "submitted", status: "signal_working" })).items[0]).toMatchObject({ id: lead.id, stage: "submitted" });
  });

  it("recalculates both lists and all report totals after reopening; repeated saves never duplicate a success", async () => {
    const { lead } = await candidate();
    await authenticate(true);
    for (let i = 0; i < 3; i++) expect((await PATCH(request(lead.id), context(lead.id))).status).toBe(200);
    const closed = await getLeadResult(lead.id);
    expect((await getLeadResults({ period: "7d" })).totals.success).toBe(1);
    expect((await getLeadResultsSuccesses({ period: "7d" })).leads.total).toBe(1);
    expect((await PATCH(request(lead.id, "in_progress"), context(lead.id))).status).toBe(200);
    expect((await listLeads({ status: "signal_working" })).items).toEqual([]);
    const reopened = await getLeadResults({ period: "7d" });
    expect(reopened.totals).toMatchObject({ leads: 1, success: 0, closed: 0 });
    expect(reopened.closures.signal_working).toBe(0);
    expect(reopened.sources.every(source => source.success === 0)).toBe(true);
    expect(reopened.daily.every(day => day.success === 0)).toBe(true);
    expect((await getLeadResultsSuccesses({ period: "7d" })).leads.total).toBe(0);
    expect((await getLeadResult(lead.id)).result.version).toBe(closed.result.version + 1);
  });

  it("rejects old hidden outcome fields and stale private notes instead of overwriting the shared status", async () => {
    const { lead } = await candidate();
    const owner = await authenticate(false);
    const old = await getLeadResult(lead.id);
    await PATCH(request(lead.id), context(lead.id));
    const oldPayload = { expectedVersion: old.result.version, qualification: "unreviewed", closure: "open",
      comment: "Stale tab", reason: null, responsibleAdminId: null };
    const response = await privateResultPATCH(new Request(`https://example.com/api/admin/leads/${lead.id}/result`, {
      method: "PATCH", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json" },
      body: JSON.stringify(oldPayload),
    }), context(lead.id));
    expect(response.status).toBe(400);
    await expect(updateLeadResult(lead.id, owner.id, {
      expectedVersion: old.result.version, comment: "Stale notes", reason: null, responsibleAdminId: null,
    })).rejects.toMatchObject({ status: 409 });
    expect((await getLeadDetails(lead.id)).lead.status).toBe("signal_working");
    expect((await getLeadResults({ period: "7d" })).totals.success).toBe(1);
  });

  it.each(["completed", "candidate_declined", "no_contact"])("keeps %s out of unfinished queue without counting it as success", async status => {
    const { lead } = await candidate();
    await authenticate(true);
    expect((await PATCH(request(lead.id, status), context(lead.id))).status).toBe(200);
    expect((await listLeads({ queue: "unfinished", inactiveMinutes: "0" })).items).toEqual([]);
    const report = await getLeadResults({ period: "7d" });
    expect(report.totals).toMatchObject({ leads: 1, success: 0, closed: 1 });
    expect((await getLeadResultsSuccesses({ period: "7d" })).leads.items).toEqual([]);
  });

  it("adds the PostgreSQL enum value without changing existing statuses or lead rows", async () => {
    const db = new PGlite();
    try {
      const journal = JSON.parse(await readFile(path.join(__dirname, "../drizzle/meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
      for (const entry of journal.entries.filter(entry => entry.idx < 17)) {
        await db.exec(await readFile(path.join(__dirname, `../drizzle/${entry.tag}.sql`), "utf8"));
      }
      for (const status of ["new", "in_progress", "awaiting_reply", "data_received", "completed", "rejected"]) {
        const { rows: [session] } = await db.query<{ id: string }>("insert into visitor_sessions(token_hash) values ($1) returning id", [`legacy-${status}`]);
        await db.query("insert into leads(session_id,status) values ($1,$2)", [session.id, status]);
      }
      const before = await db.query("select * from leads order by id");
      await db.exec(await readFile(path.join(__dirname, "../drizzle/0017_operational_signal_working.sql"), "utf8"));
      expect((await db.query("select * from leads order by id")).rows).toEqual(before.rows);
      await db.query("update leads set status='signal_working' where id=1");
      expect((await db.query<{ status: string }>("select status from leads where id=1")).rows[0].status).toBe("signal_working");
      await expect(db.query("update leads set status='unknown' where id=1")).rejects.toThrow();
    } finally { await db.close(); }
  });
});
