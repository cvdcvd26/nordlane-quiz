import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { LEAD_STATUSES, QUESTION_KEYS } from "@/config/content";
import { defaultSettings } from "@/config/settings";
import { GET } from "@/app/api/admin/leads/route";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { listLeads, updateLeadStatus } from "@/server/services/admin";
import { postVisitorMessage } from "@/server/services/chat";
import { deleteLeads } from "@/server/services/leads";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { updateSettings } from "@/server/settings";
import { newSession, PDF, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));
const secret = "submitted-queue-tests-secret-with-at-least-32-characters";
let env: Awaited<ReturnType<typeof setupTestEnv>>;

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  jar.clear(); env.blobs.clear(); env.queued.length = 0;
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.appSettings);
  await updateSettings({ ...defaultSettings, autoMessageEnabled: false });
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

async function candidate(name = "Submitted candidate", answered = QUESTION_KEYS.length) {
  const sid = await newSession(env.db);
  await saveContact(sid, { name, phone: "600123456" });
  for (const key of QUESTION_KEYS.slice(0, answered)) await saveAnswer(sid, key, "yes");
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  return { sid, lead };
}

async function submit(sid: string) {
  const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor",
    file: { name: "test.png", type: "image/png", buffer: PNG } });
  const input = { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis wykonanego zadania testowego." };
  return { result: await submitTask(sid, input), input };
}

describe("submitted-task lead queue", () => {
  it("adds only actual task submissions automatically and only once, keeping every lead in the all queue", async () => {
    await candidate("Contact only", 0);
    const ready = await candidate("Chat document only");
    await updateLeadStatus(ready.lead.id, { status: "data_received" });
    const file = await uploadFile({ sessionId: ready.sid, purpose: "chat", uploadedBy: "visitor",
      file: { name: "chat.pdf", type: "application/pdf", buffer: PDF } });
    await postVisitorMessage(ready.sid, { clientMessageId: randomUUID(), body: "", fileIds: [file.id] });
    expect((await listLeads({ queue: "submitted" })).submittedCount).toBe(0);
    expect((await listLeads({ queue: "submitted" })).items).toEqual([]);
    expect((await listLeads({})).items.every(item => item.submittedAt === null)).toBe(true);

    const { result, input } = await submit(ready.sid);
    const retry = await submitTask(ready.sid, input);
    expect(retry).toMatchObject({ submissionId: result.submissionId, duplicate: true });
    const completed = await listLeads({ queue: "submitted" });
    expect(completed.total).toBe(1);
    expect(completed.submittedCount).toBe(1);
    expect(completed.items).toMatchObject([{ id: ready.lead.id, stage: "submitted", submitted: true,
      submittedAt: result.submittedAt, status: "data_received" }]);
    expect((await listLeads({})).total).toBe(2);
    expect((await listLeads({})).submittedCount).toBe(1);
    expect(await env.db.select().from(schema.taskSubmissions)).toHaveLength(1);
  });

  it("includes submitted leads in every handling status and excludes a closed lead without a submission", async () => {
    const expected: number[] = [];
    for (const status of LEAD_STATUSES) {
      const { sid, lead } = await candidate(`Status ${status}`);
      await submit(sid);
      await updateLeadStatus(lead.id, { status });
      expected.push(lead.id);
    }
    const unsent = await candidate("Closed without task");
    await updateLeadStatus(unsent.lead.id, { status: "completed" });
    const result = await listLeads({ queue: "submitted" });
    expect(result.total).toBe(LEAD_STATUSES.length);
    expect(result.submittedCount).toBe(LEAD_STATUSES.length);
    expect(result.items.map(item => item.id).sort((a, b) => a - b)).toEqual(expected);
    expect(result.items.every(item => item.stage === "submitted" && !item.isUnfinished)).toBe(true);
    expect((await listLeads({})).total).toBe(LEAD_STATUSES.length + 1);
  });

  it("sorts by the task send time rather than the lead creation time, with reversible stable ordering", async () => {
    const olderLead = await candidate("Old lead, new task");
    const newerLead = await candidate("New lead, old task");
    const olderLeadTask = await submit(olderLead.sid);
    const newerLeadTask = await submit(newerLead.sid);
    await env.db.update(schema.leads).set({ createdAt: new Date("2026-09-01T10:00:00Z") }).where(eq(schema.leads.id, olderLead.lead.id));
    await env.db.update(schema.leads).set({ createdAt: new Date("2026-10-01T10:00:00Z") }).where(eq(schema.leads.id, newerLead.lead.id));
    await env.db.update(schema.taskSubmissions).set({ submittedAt: new Date("2026-10-30T12:00:00Z") }).where(eq(schema.taskSubmissions.id, olderLeadTask.result.submissionId));
    await env.db.update(schema.taskSubmissions).set({ submittedAt: new Date("2026-10-30T10:00:00Z") }).where(eq(schema.taskSubmissions.id, newerLeadTask.result.submissionId));
    expect((await listLeads({})).items.map(item => item.id)).toEqual([newerLead.lead.id, olderLead.lead.id]);
    const newestFirst = await listLeads({ queue: "submitted" });
    expect(newestFirst.items.map(item => item.id)).toEqual([olderLead.lead.id, newerLead.lead.id]);
    expect(newestFirst.items[0].submittedAt).toBe("2026-10-30T12:00:00.000Z");
    expect((await listLeads({ queue: "submitted", sort: "asc" })).items.map(item => item.id)).toEqual([newerLead.lead.id, olderLead.lead.id]);
    await env.db.update(schema.taskSubmissions).set({ submittedAt: new Date("2026-10-30T12:00:00Z") }).where(eq(schema.taskSubmissions.id, newerLeadTask.result.submissionId));
    expect((await listLeads({ queue: "submitted" })).items.map(item => item.id)).toEqual([newerLead.lead.id, olderLead.lead.id]);
  });

  it("combines search, handling status and pages while retaining the global counter and reflecting deletion", async () => {
    const submitted: number[] = [];
    for (let i = 0; i < 7; i++) {
      const { sid, lead } = await candidate(`Matching candidate ${i}`);
      await submit(sid);
      await updateLeadStatus(lead.id, { status: i < 3 ? "data_received" : "in_progress" });
      submitted.push(lead.id);
    }
    await candidate("Matching but not submitted");
    const first = await listLeads({ queue: "submitted", q: "Matching", pageSize: "5" });
    const second = await listLeads({ queue: "submitted", q: "Matching", pageSize: "5", page: "2" });
    expect(first.total).toBe(7); expect(first.submittedCount).toBe(7);
    expect(first.items).toHaveLength(5); expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(7);
    const filtered = await listLeads({ queue: "submitted", q: "Matching", status: "data_received" });
    expect(filtered.total).toBe(3); expect(filtered.submittedCount).toBe(7);
    expect(filtered.items.every(item => item.status === "data_received")).toBe(true);
    const empty = await listLeads({ queue: "submitted", q: "no matching candidate exists" });
    expect(empty.total).toBe(0); expect(empty.submittedCount).toBe(7);
    await deleteLeads([submitted[0]]);
    expect((await listLeads({ queue: "submitted" })).submittedCount).toBe(6);
    expect((await listLeads({})).total).toBe(7);
  });

  it("serves the queue through the existing authenticated API to permanent and temporary administrators", async () => {
    const { sid, lead } = await candidate("API submitted test");
    await submit(sid);
    const request = () => new Request("https://example.com/api/admin/leads?queue=submitted&q=API&status=new");
    expect((await GET(request())).status).toBe(401);
    for (const isTemporary of [false, true]) {
      const [admin] = await env.db.insert(schema.adminUsers).values({ email: `${isTemporary ? "manager" : "owner"}@example.com`, passwordHash: "unused", isTemporary }).returning();
      jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
        .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const result = await response.json();
      expect(result).toMatchObject({ submittedCount: 1, total: 1, items: [{ id: lead.id, submitted: true, submittedAt: expect.any(String) }] });
    }
    expect((await GET(new Request("https://example.com/api/admin/leads?queue=not-a-queue"))).status).toBe(400);
  });
});
