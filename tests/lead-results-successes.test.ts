import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { LeadClosure, LeadResultsSuccessList } from "@/config/lead-results";
import { GET } from "@/app/api/admin/lead-results/successes/route";
import { getLeadResults, getLeadResultsSuccesses, updateLeadResult } from "@/server/services/lead-results";
import { setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));

const secret = "success-list-tests-secret-with-at-least-thirty-two-characters";
const cohort = { period: "custom", from: "2020-10-01", to: "2020-10-07" };
const closingTime = new Date("2026-10-28T12:00:00Z");
const google = JSON.stringify(["utm", "google", "cpc", "october"]);
const unknown = JSON.stringify(["unknown", null, null, null]);
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let owner: typeof schema.adminUsers.$inferSelect;
let staff: typeof schema.adminUsers.$inferSelect;

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  jar.clear();
  vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.rateLimits);
  [owner, staff] = await env.db.insert(schema.adminUsers).values([
    { email: "owner@example.test", passwordHash: "unused" },
    { email: "operator@example.test", passwordHash: "unused", isTemporary: true },
  ]).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

async function authenticate(admin = owner) {
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
}
function request(query: Record<string, string> = cohort) {
  return new Request(`https://example.com/api/admin/lead-results/successes?${new URLSearchParams(query)}`);
}
function privateResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}
async function candidate(options: {
  createdAt?: string;
  sessionCreatedAt?: string;
  closure?: LeadClosure;
  responsibleAdminId?: string | null;
  attribution?: Partial<typeof schema.visitorAttribution.$inferInsert>;
  status?: typeof schema.leads.$inferInsert.status;
} = {}) {
  const [session] = await env.db.insert(schema.visitorSessions).values({ tokenHash: randomUUID(),
    createdAt: new Date(options.sessionCreatedAt ?? "2019-01-01T12:00:00Z") }).returning();
  const [lead] = await env.db.insert(schema.leads).values({ sessionId: session.id,
    createdAt: new Date(options.createdAt ?? "2020-10-03T12:00:00Z"), status: options.status ?? "new" }).returning();
  await env.db.insert(schema.visitorContacts).values({ sessionId: session.id, name: `Candidate ${lead.id}`, phone: "+48600123456" });
  if (options.attribution) await env.db.insert(schema.visitorAttribution).values({ sessionId: session.id, ...options.attribution });
  await updateLeadResult(lead.id, owner.id, {
    expectedVersion: 0, qualification: "suitable", closure: options.closure ?? "signal_working", reason: null,
    comment: "Private result", responsibleAdminId: options.responsibleAdminId ?? null,
  }, closingTime);
  return lead;
}
const googleAttribution = { consentAll: true, utmSource: "google", utmMedium: "cpc", utmCampaign: "october" };
async function domainSnapshot() {
  return {
    leads: await env.db.select().from(schema.leads), results: await env.db.select().from(schema.leadResults),
    history: await env.db.select().from(schema.leadResultHistory), sessions: await env.db.select().from(schema.visitorSessions),
    contacts: await env.db.select().from(schema.visitorContacts), attribution: await env.db.select().from(schema.visitorAttribution),
    conversations: await env.db.select().from(schema.conversations), messages: await env.db.select().from(schema.messages),
    submissions: await env.db.select().from(schema.taskSubmissions), scheduled: await env.db.select().from(schema.scheduledMessages),
  };
}

describe("owner-only successful lead drilldown", () => {
  it("rejects anonymous, forged and secondary accounts before URL parsing or rate-limit writes", async () => {
    for (const kind of ["anonymous", "forged", "staff"] as const) {
      jar.clear();
      if (kind === "forged") jar.set("nl_admin", "forged-token");
      if (kind === "staff") await authenticate(staff);
      const req = request({ period: "malformed" });
      const url = vi.fn(() => { throw new Error("Unauthorized URL must not be read"); });
      Object.defineProperty(req, "url", { get: url });
      const response = await GET(req);
      privateResponse(response, kind === "staff" ? 403 : 401);
      expect(url).not.toHaveBeenCalled();
    }
    expect(await env.db.select().from(schema.rateLimits)).toEqual([]);
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
  });

  it("rechecks database role and revoked sessions before returning successful candidate data", async () => {
    await candidate();
    await authenticate();
    await env.db.update(schema.adminUsers).set({ isTemporary: true }).where(eq(schema.adminUsers.id, owner.id));
    privateResponse(await GET(request()), 403);
    await env.db.update(schema.adminUsers).set({ isTemporary: false, tokenVersion: owner.tokenVersion + 1 }).where(eq(schema.adminUsers.id, owner.id));
    privateResponse(await GET(request()), 401);
    expect(await env.db.select().from(schema.rateLimits)).toEqual([]);
  });

  it("paginates only current successes in the applied lead-created Warsaw cohort and source/responsible filters", async () => {
    const matched = [];
    for (const createdAt of ["2020-09-30T22:00:00Z", "2020-10-02T12:00:00Z", "2020-10-03T12:00:00Z", "2020-10-04T12:00:00Z", "2020-10-07T21:59:59.999Z"]) {
      matched.push(await candidate({ createdAt, attribution: googleAttribution, responsibleAdminId: staff.id }));
    }
    await candidate({ attribution: googleAttribution, responsibleAdminId: owner.id });
    await candidate({ attribution: { ...googleAttribution, utmSource: "other" }, responsibleAdminId: staff.id });
    await candidate({ attribution: googleAttribution, responsibleAdminId: staff.id, closure: "open", status: "completed" });
    await candidate({ attribution: googleAttribution, responsibleAdminId: staff.id, closure: "data_received", status: "completed" });
    await candidate({ attribution: googleAttribution, responsibleAdminId: staff.id, closure: "candidate_declined" });
    await candidate({ createdAt: "2020-09-30T21:59:59.999Z", attribution: googleAttribution, responsibleAdminId: staff.id });
    await candidate({ createdAt: "2020-10-07T22:00:00Z", attribution: googleAttribution, responsibleAdminId: staff.id });
    // Current closure, rather than a historical success audit entry, is authoritative.
    const reopened = await candidate({ attribution: googleAttribution, responsibleAdminId: staff.id });
    await updateLeadResult(reopened.id, owner.id, { expectedVersion: 1, qualification: "suitable", closure: "open",
      reason: null, comment: "Reopened", responsibleAdminId: staff.id });
    await authenticate();
    const pages: LeadResultsSuccessList[] = [];
    for (const page of ["1", "2", "3"]) {
      const response = await GET(request({ ...cohort, source: google, responsible: staff.id, page, pageSize: "2" }));
      privateResponse(response, 200);
      const body: LeadResultsSuccessList = await response.json();
      expect(Object.keys(body).sort()).toEqual(["filters", "generatedAt", "leads", "range"]);
      expect(body.range).toEqual({ from: cohort.from, to: cohort.to, timezone: "Europe/Warsaw" });
      expect(body.filters).toEqual({ source: google, responsible: staff.id });
      expect(body.leads).toMatchObject({ total: 5, page: Number(page), pageSize: 2, pages: 3 });
      expect(body.leads.items.every(item => item.result.closure === "signal_working" && item.result.closedAt === closingTime.toISOString())).toBe(true);
      pages.push(body);
    }
    expect(pages.map(page => page.leads.items.length)).toEqual([2, 2, 1]);
    expect(pages.flatMap(page => page.leads.items.map(item => item.id))).toEqual(matched.map(lead => lead.id).reverse());
    const outsidePage = await getLeadResultsSuccesses({ ...cohort, source: google, responsible: staff.id, page: "4", pageSize: "2" }, closingTime);
    expect(outsidePage.leads).toMatchObject({ total: 5, items: [], page: 4, pages: 3 });
  });

  it("hides attribution without consent and supports unknown sources and unassigned staff", async () => {
    const unknownSuccess = await candidate({ attribution: { consentAll: false, utmSource: "PRIVATE_LEGACY_SOURCE", utmCampaign: "PRIVATE_LEGACY_CAMPAIGN", referrerHost: "private.example" } });
    await candidate({ attribution: { consentAll: true, referrerHost: "jobs.example" }, responsibleAdminId: staff.id });
    await candidate({ attribution: { consentAll: true }, responsibleAdminId: staff.id });
    await candidate({ attribution: { consentAll: false }, closure: "no_contact" });
    await authenticate();
    const response = await GET(request({ ...cohort, source: unknown, responsible: "unassigned" }));
    privateResponse(response, 200);
    const body: LeadResultsSuccessList = await response.json();
    expect(body.leads.total).toBe(1);
    expect(body.leads.items[0]).toMatchObject({ id: unknownSuccess.id, source: { kind: "unknown", source: null, medium: null, campaign: null }, responsible: null });
    const all = await getLeadResultsSuccesses(cohort, closingTime);
    expect(all.leads.total).toBe(3);
    expect(JSON.stringify(all)).not.toMatch(/PRIVATE_LEGACY|private\.example/);
  });

  it("returns honest empty pagination for an empty successful cohort", async () => {
    await candidate({ closure: "open" });
    await candidate({ closure: "not_suitable" });
    await authenticate();
    const response = await GET(request());
    privateResponse(response, 200);
    expect((await response.json()).leads).toEqual({ items: [], total: 0, page: 1, pageSize: 25, pages: 0 });
  });

  it("uses the existing bounded range/filter/pagination validation with private error responses", async () => {
    await authenticate();
    for (const input of [
      { ...cohort, page: "0" }, { ...cohort, pageSize: "101" }, { ...cohort, responsible: "avatar-manager" },
      { ...cohort, source: "malformed" }, { ...cohort, closure: "open" },
      { ...cohort, from: "2020-02-30", to: "2020-03-01" }, { ...cohort, from: "2020-01-01", to: "2021-01-01" },
    ]) privateResponse(await GET(request(input)), 400);
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
  });

  it("leaves overview numbers, private records and candidate workflow unchanged after all pages are read", async () => {
    const success = await candidate({ responsibleAdminId: staff.id, attribution: googleAttribution });
    await candidate({ closure: "open" });
    await candidate({ closure: "no_contact" });
    const [conversation] = await env.db.insert(schema.conversations).values({ sessionId: success.sessionId, leadId: success.id }).returning();
    await env.db.insert(schema.messages).values({ conversationId: conversation.id, sender: "admin", body: "Existing conversation", clientMessageId: randomUUID() });
    const [submission] = await env.db.insert(schema.taskSubmissions).values({ sessionId: success.sessionId, idempotencyKey: randomUUID() }).returning();
    await env.db.insert(schema.scheduledMessages).values({ submissionId: submission.id, conversationId: conversation.id, scheduledFor: closingTime });
    const before = await domainSnapshot();
    const overview = await getLeadResults(cohort, closingTime);
    await authenticate();
    for (const page of ["1", "2"]) privateResponse(await GET(request({ ...cohort, page, pageSize: "1" })), 200);
    expect(await domainSnapshot()).toEqual(before);
    expect(await getLeadResults(cohort, closingTime)).toEqual(overview);
    expect(overview.totals).toMatchObject({ leads: 3, success: 1 });
    expect(env.queued).toEqual([]);
    expect(env.blobs.size).toBe(0);
    const limits = await env.db.select().from(schema.rateLimits);
    expect(limits.length).toBeGreaterThan(0);
    expect(limits.every(row => row.key === `admin-lead-results-successes:${owner.id}`)).toBe(true);
  });

  it("keeps unexpected storage errors private and does not log SQL parameters", async () => {
    await authenticate();
    const execute = vi.spyOn(env.db, "execute").mockRejectedValueOnce(new Error("PRIVATE_SQL_PARAMS"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await GET(request());
      privateResponse(response, 500);
      expect(await response.json()).toMatchObject({ code: "lead_results_failed" });
      expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain("PRIVATE_SQL_PARAMS");
      expect(error).not.toHaveBeenCalled();
    } finally { execute.mockRestore(); warn.mockRestore(); error.mockRestore(); }
  });
});
