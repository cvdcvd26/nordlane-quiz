import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { PATCH } from "@/app/api/admin/leads/[id]/route";
import { saveContact } from "@/server/services/contact";
import { getVisitorState, saveAnswer } from "@/server/services/quiz";
import { getLeadDetails, listLeads, updateLeadStatus } from "@/server/services/admin";
import { getLeadResult, getLeadResults } from "@/server/services/lead-results";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { newSession, PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));
const secret = "operational-awaiting-data-test-secret-with-32-characters";
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
  await saveContact(sid, { name: "Awaiting details test", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  return { sid, lead };
}

function request(id: number) {
  return new Request(`https://example.com/api/admin/leads/${id}`, {
    method: "PATCH", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json" },
    body: JSON.stringify({ status: "awaiting_data" }),
  });
}
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("task completed, awaiting data status", () => {
  it("can be saved and filtered by both main and staff admins through the shared API", async () => {
    const { lead } = await candidate();
    expect((await PATCH(request(lead.id), context(lead.id))).status).toBe(401);
    for (const isTemporary of [false, true]) {
      const [admin] = await env.db.insert(schema.adminUsers).values({
        email: `${isTemporary ? "staff" : "owner"}@example.test`, passwordHash: "unused", isTemporary,
      }).returning();
      jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
        .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
      await updateLeadStatus(lead.id, { status: "in_progress" });
      const response = await PATCH(request(lead.id), context(lead.id));
      expect(response.status).toBe(200);
      expect((await response.json()).lead.status).toBe("awaiting_data");
      expect((await listLeads({ status: "awaiting_data" })).items.map(item => item.id)).toEqual([lead.id]);
      expect((await getLeadResult(lead.id)).result).toMatchObject({ status: "awaiting_data", closure: "open", closedAt: null });
    }
  });

  it("does not fabricate a submission or mark an unfinished candidate as successfully hired", async () => {
    const { sid, lead } = await candidate();
    await updateLeadStatus(lead.id, { status: "awaiting_data" });
    expect((await getVisitorState(sid)).submission).toBeNull();
    expect((await getLeadDetails(lead.id)).lead.stage).toBe("task");
    const report = await getLeadResults({ period: "7d" });
    expect(report.totals).toMatchObject({ success: 0, closed: 0 });
    expect(report.closures.open).toBe(1);
    expect((await listLeads({ queue: "submitted" })).items).toEqual([]);
  });

  it("retains a real submission and advances from awaiting data to data received and Signal success", async () => {
    const { sid, lead } = await candidate();
    const file = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: { name: "task.png", type: "image/png", buffer: PNG } });
    await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis wykonanego zadania testowego." });
    await updateLeadStatus(lead.id, { status: "awaiting_data" });
    expect((await getLeadDetails(lead.id)).lead.stage).toBe("submitted");
    expect((await getVisitorState(sid)).submission).not.toBeNull();
    expect((await getLeadResults({ period: "7d" })).totals).toMatchObject({ success: 0, closed: 0 });
    await updateLeadStatus(lead.id, { status: "data_received" });
    expect((await getLeadResults({ period: "7d" })).closures.data_received).toBe(1);
    await updateLeadStatus(lead.id, { status: "signal_working" });
    expect((await getLeadResults({ period: "7d" })).totals).toMatchObject({ success: 1, closed: 1 });
    await updateLeadStatus(lead.id, { status: "awaiting_data" });
    expect((await getLeadResults({ period: "7d" })).totals).toMatchObject({ success: 0, closed: 0 });
  });
});
