import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { LeadResultUpdate } from "@/config/lead-results";
import { GET as reportGET } from "@/app/api/admin/lead-results/route";
import { GET as resultGET, PATCH } from "@/app/api/admin/leads/[id]/result/route";
import { GET as leadGET } from "@/app/api/admin/leads/[id]/route";
import { getSessionOutcome } from "@/server/services/candidate-outcome";
import { setupTestEnv, newSession } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));

const secret = "lead-results-api-test-secret-with-at-least-thirty-two-characters";
const valid: LeadResultUpdate = {
  qualification: "suitable", closure: "signal_working", reason: null, comment: "PRIVATE_RESULT_COMMENT",
  responsibleAdminId: null, expectedVersion: 0,
};
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let owner: typeof schema.adminUsers.$inferSelect;
let staff: typeof schema.adminUsers.$inferSelect;
let lead: typeof schema.leads.$inferSelect;

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  jar.clear();
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.rateLimits);
  [owner, staff] = await env.db.insert(schema.adminUsers).values([
    { email: "owner@example.test", passwordHash: "unused" },
    { email: "staff@example.test", passwordHash: "unused", isTemporary: true },
  ]).returning();
  const sessionId = await newSession(env.db);
  [lead] = await env.db.insert(schema.leads).values({ sessionId }).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

async function authenticate(admin = owner) {
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
}
const context = (id: number | string = lead.id) => ({ params: Promise.resolve({ id: String(id) }) });
const reportRequest = (query = "") => new Request(`https://example.com/api/admin/lead-results${query}`);
const resultRequest = () => new Request(`https://example.com/api/admin/leads/${lead.id}/result`);
function patchRequest(body: unknown = valid, headers: Record<string, string> = {}) {
  return new Request(`https://example.com/api/admin/leads/${lead.id}/result`, {
    method: "PATCH", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
function privateResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

describe("owner-only lead results APIs", () => {
  it("requires a real main-admin session for every endpoint before reading or mutating a payload", async () => {
    for (const credentials of ["anonymous", "forged", "staff"] as const) {
      if (credentials === "forged") jar.set("nl_admin", "forged-token");
      if (credentials === "staff") await authenticate(staff);
      const expected = credentials === "staff" ? 403 : 401;
      privateResponse(await reportGET(reportRequest("?period=all")), expected);
      privateResponse(await resultGET(resultRequest(), context()), expected);
      const req = patchRequest(null, { "content-length": "999999" });
      privateResponse(await PATCH(req, context()), expected);
      expect(req.bodyUsed).toBe(false);
    }
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
    expect(await env.db.select().from(schema.leadResultHistory)).toEqual([]);
    expect(await env.db.select().from(schema.rateLimits)).toEqual([]);
  });

  it("rechecks current database permissions and session revocation on every request", async () => {
    await authenticate();
    await env.db.update(schema.adminUsers).set({ isTemporary: true }).where(eq(schema.adminUsers.id, owner.id));
    privateResponse(await reportGET(reportRequest()), 403);
    privateResponse(await resultGET(resultRequest(), context()), 403);
    const forbidden = patchRequest();
    privateResponse(await PATCH(forbidden, context()), 403);
    expect(forbidden.bodyUsed).toBe(false);
    await env.db.update(schema.adminUsers).set({ isTemporary: false, tokenVersion: owner.tokenVersion + 1 }).where(eq(schema.adminUsers.id, owner.id));
    privateResponse(await resultGET(resultRequest(), context()), 401);
    privateResponse(await PATCH(patchRequest(), context()), 401);
    await env.db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, owner.id));
    privateResponse(await reportGET(reportRequest()), 401);
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
    expect(await env.db.select().from(schema.leadResultHistory)).toEqual([]);
  });

  it("rejects cross-site and protocol-downgrade PATCH requests before reading private fields", async () => {
    await authenticate();
    const attempts: Record<string, string>[] = [
      { origin: "https://attacker.example" }, { origin: "http://example.com" }, { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of attempts) {
      const req = patchRequest(valid, headers);
      privateResponse(await PATCH(req, context()), 403);
      expect(req.bodyUsed).toBe(false);
    }
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
    expect(await env.db.select().from(schema.leadResultHistory)).toEqual([]);
  });

  it.each(["signal_working", "data_received"] as const)("saves %s and its audit only for the owner, without exposing it to other admins or candidates", async closure => {
    await authenticate();
    const response = await PATCH(patchRequest({ ...valid, closure, responsibleAdminId: staff.id }), context());
    privateResponse(response, 200);
    const detail = await response.json();
    expect(detail).toMatchObject({ leadId: lead.id, hasSavedResult: true, result: { qualification: "suitable", closure, version: 1,
      comment: valid.comment, responsibleAdminId: staff.id, updatedById: owner.id } });
    expect(detail.history).toHaveLength(1);
    privateResponse(await resultGET(resultRequest(), context()), 200);
    const report = await reportGET(reportRequest());
    privateResponse(report, 200);
    expect(await report.json()).toMatchObject({ totals: { leads: 1, success: closure === "signal_working" ? 1 : 0 } });
    const stored = (await env.db.select().from(schema.leads))[0];
    expect(stored).toEqual(lead);
    expect(await getSessionOutcome(lead.sessionId)).toBeNull();

    await authenticate(staff);
    const normalLead = await leadGET(new Request(`https://example.com/api/admin/leads/${lead.id}`), context());
    expect(normalLead.status).toBe(200);
    const body = await normalLead.text();
    expect(body).not.toContain(valid.comment);
    expect(body).not.toContain("responsibleAdminId");
    expect(body).not.toContain("data_received");
    privateResponse(await resultGET(resultRequest(), context()), 403);
    privateResponse(await PATCH(patchRequest({ ...valid, closure: "data_received", expectedVersion: 1 }), context()), 403);
    expect(await env.db.select().from(schema.messages)).toEqual([]);
    expect(await env.db.select().from(schema.scheduledMessages)).toEqual([]);
  });

  it("rejects invalid fields, forged ownership and stale versions without changing a saved decision", async () => {
    await authenticate();
    const invalid = [
      null, { ...valid, qualification: "hired" }, { ...valid, closure: "completed" },
      { ...valid, reason: "unapproved" }, { ...valid, comment: "x".repeat(2001) },
      { ...valid, responsibleAdminId: randomUUID() }, { ...valid, responsibleAdminId: lead.managerId },
      { ...valid, expectedVersion: -1 }, { ...valid, expectedVersion: undefined },
      { ...valid, status: "completed" }, { ...valid, updatedById: staff.id },
    ];
    for (const body of invalid) privateResponse(await PATCH(patchRequest(body), context()), 400);
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
    expect(await env.db.select().from(schema.leadResultHistory)).toEqual([]);
    const saved = await PATCH(patchRequest({ ...valid, comment: "x".repeat(2000), reason: "other" }), context());
    privateResponse(saved, 200);
    expect((await saved.json()).result).toMatchObject({ comment: "x".repeat(2000), reason: "other", version: 1 });
    const stale = await PATCH(patchRequest({ ...valid, comment: "Stale replacement" }), context());
    privateResponse(stale, 409);
    expect(await stale.json()).toMatchObject({ code: "lead_result_changed" });
    expect((await env.db.select().from(schema.leadResults))[0]).toMatchObject({ comment: "x".repeat(2000), version: 1 });
    expect(await env.db.select().from(schema.leadResultHistory)).toHaveLength(1);
  });

  it("validates bounded report ranges, filters and pagination, with private errors for missing leads", async () => {
    await authenticate();
    for (const query of [
      "?period=all", "?period=custom&from=2026-02-30&to=2026-03-01", "?period=custom&from=2024-01-01&to=2025-01-01",
      "?page=0", "?pageSize=101", "?responsible=manager-avatar", "?source=not-a-source-key", "?sessionId=forged",
    ]) privateResponse(await reportGET(reportRequest(query)), 400);
    privateResponse(await resultGET(resultRequest(), context(9999999)), 404);
    privateResponse(await PATCH(patchRequest(), context(9999999)), 404);
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
  });

  it("rolls back audit and current state together on storage failure and suppresses private SQL parameters", async () => {
    await authenticate();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.client.exec(`
      create function reject_result_audit() returns trigger language plpgsql as $$ begin raise exception 'Simulated audit failure'; end $$;
      create trigger reject_result_audit before insert on lead_result_history for each row execute function reject_result_audit();
    `);
    try {
      const failed = await PATCH(patchRequest(), context());
      privateResponse(failed, 500);
      const body = await failed.text();
      expect(body).not.toContain(valid.comment);
      expect(JSON.parse(body)).toMatchObject({ code: "lead_results_failed" });
      const diagnostics = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(diagnostics).not.toContain(valid.comment);
      expect(diagnostics).not.toMatch(/Failed query|params:/);
      expect(error).not.toHaveBeenCalled();
      expect(await env.db.select().from(schema.leadResults)).toEqual([]);
      expect(await env.db.select().from(schema.leadResultHistory)).toEqual([]);
      expect((await env.db.select().from(schema.leads))[0]).toEqual(lead);
    } finally {
      await env.client.exec("drop trigger if exists reject_result_audit on lead_result_history; drop function if exists reject_result_audit();");
      warn.mockRestore(); error.mockRestore();
    }
  });
});
