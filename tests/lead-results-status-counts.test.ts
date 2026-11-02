import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { schema } from "@/db";
import { ACTIVE_LEAD_STATUSES, LEAD_STATUSES, type LeadStatus } from "@/config/content";
import type { LeadStatusCounts } from "@/config/lead-results";
import { getLeadResult, getLeadResults, updateLeadResult } from "@/server/services/lead-results";
import { listLeads, updateLeadStatus } from "@/server/services/admin";
import { setupTestEnv } from "./helpers";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let owner: typeof schema.adminUsers.$inferSelect;
let staff: typeof schema.adminUsers.$inferSelect;
const now = new Date("2026-11-03T12:00:00Z");
const cohort = { period: "custom", from: "2026-10-01", to: "2026-10-07" };
const facebook = JSON.stringify(["utm", "facebook", "paid", "hiring"]);
const countStatuses = (statuses: LeadStatus[]) => Object.fromEntries(LEAD_STATUSES.map(status => [status, statuses.filter(value => value === status).length])) as LeadStatusCounts;

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  [owner, staff] = await env.db.insert(schema.adminUsers).values([
    { email: "owner@example.test", passwordHash: "unused" },
    { email: "staff@example.test", passwordHash: "unused", isTemporary: true },
  ]).returning();
});
afterAll(async () => { await env.client.close(); });

async function candidate(status: LeadStatus, options: { createdAt?: string; source?: string; responsible?: string } = {}) {
  const [session] = await env.db.insert(schema.visitorSessions).values({ tokenHash: randomUUID() }).returning();
  const [lead] = await env.db.insert(schema.leads).values({
    sessionId: session.id, createdAt: new Date(options.createdAt ?? "2026-10-03T12:00:00Z"),
  }).returning();
  await updateLeadStatus(lead.id, { status }, owner.id, now);
  if (options.source) await env.db.insert(schema.visitorAttribution).values({
    sessionId: session.id, consentAll: true, utmSource: options.source, utmMedium: "paid", utmCampaign: "hiring",
  });
  if (options.responsible) await updateLeadResult(lead.id, owner.id, {
    expectedVersion: (await getLeadResult(lead.id)).result.version,
    reason: null, comment: "", responsibleAdminId: options.responsible,
  }, now);
  return lead;
}

describe("result distribution matches the exact status in the lead list", () => {
  it("counts each of the six active and every retained legacy status independently of report pagination", async () => {
    for (const status of LEAD_STATUSES) await candidate(status);
    for (const status of ["new", "awaiting_data", "awaiting_data"] as const) await candidate(status);
    const before = await env.db.select().from(schema.leads);
    const report = await getLeadResults({ ...cohort, pageSize: "2", page: "2" }, now);
    expect(Object.keys(report.statuses).sort()).toEqual([...LEAD_STATUSES].sort());
    expect(report.leads.items).toHaveLength(2);
    for (const status of LEAD_STATUSES) {
      const list = await listLeads({ status });
      expect(report.statuses[status], status).toBe(list.total);
      expect(list.items.every(item => item.status === status)).toBe(true);
    }
    expect(report.statuses).toMatchObject({ new: 2, in_progress: 1, awaiting_data: 3, data_received: 1, signal_working: 1, rejected: 1 });
    expect(Object.values(report.statuses).reduce((sum, count) => sum + count, 0)).toBe(report.totals.leads);
    expect(report.statuses.signal_working).toBe(report.totals.success);
    expect(report.sources[0].statuses).toEqual(report.statuses);
    expect(report.responsibles[0].statuses).toEqual(report.statuses);
    expect(await env.db.select().from(schema.leads)).toEqual(before);
  });

  it("applies the same Warsaw creation dates, source and responsible filters to distribution and report rows", async () => {
    const included = [
      await candidate("new", { createdAt: "2026-09-30T22:00:00Z", source: "facebook", responsible: staff.id }),
      await candidate("in_progress", { source: "facebook", responsible: staff.id }),
      await candidate("awaiting_data", { source: "facebook", responsible: staff.id }),
      await candidate("signal_working", { createdAt: "2026-10-07T21:59:59.999Z", source: "facebook", responsible: staff.id }),
    ];
    await candidate("awaiting_data", { source: "facebook", responsible: owner.id });
    await candidate("new", { source: "google", responsible: staff.id });
    await candidate("rejected", { source: "facebook" });
    for (const createdAt of ["2026-09-30T21:59:59.999Z", "2026-10-07T22:00:00Z"]) {
      await candidate("data_received", { createdAt, source: "facebook", responsible: staff.id });
    }
    const report = await getLeadResults({ ...cohort, source: facebook, responsible: staff.id }, now);
    expect(report.totals.leads).toBe(4);
    expect(new Set(report.leads.items.map(item => item.id))).toEqual(new Set(included.map(item => item.id)));
    expect(report.statuses).toMatchObject({ new: 1, in_progress: 1, awaiting_data: 1, data_received: 0, signal_working: 1, rejected: 0 });
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0].statuses).toEqual(report.statuses);
    expect(report.responsibles).toHaveLength(1);
    expect(report.responsibles[0].statuses).toEqual(report.statuses);
    for (const status of LEAD_STATUSES) {
      const list = await listLeads({ status, pageSize: "100" });
      expect(report.statuses[status]).toBe(list.items.filter(item => included.some(expected => expected.id === item.id)).length);
    }
    const unassigned = await getLeadResults({ ...cohort, source: facebook, responsible: "unassigned" }, now);
    expect(unassigned.totals.leads).toBe(1);
    expect(unassigned.statuses.rejected).toBe(1);
    expect(Object.values(unassigned.statuses).reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("moves a lead between exact buckets on status edits without counting audit rows as extra leads", async () => {
    const lead = await candidate("awaiting_data");
    for (const [index, status] of (["awaiting_data", "data_received", "signal_working", "in_progress"] as const).entries()) {
      await updateLeadStatus(lead.id, { status }, staff.id, now);
      await updateLeadResult(lead.id, owner.id, {
        expectedVersion: (await getLeadResult(lead.id)).result.version,
        reason: null, comment: `Metadata update ${index}`, responsibleAdminId: staff.id,
      }, now);
      const report = await getLeadResults(cohort, now);
      expect(report.totals.leads).toBe(1);
      expect(report.statuses[status]).toBe(1);
      expect(Object.values(report.statuses).reduce((sum, count) => sum + count, 0)).toBe(1);
      for (const other of ACTIVE_LEAD_STATUSES.filter(value => value !== status)) expect(report.statuses[other]).toBe(0);
      expect(report.totals.success).toBe(status === "signal_working" ? 1 : 0);
      expect(report.sources[0].statuses).toEqual(report.statuses);
      expect(report.responsibles[0].statuses).toEqual(report.statuses);
    }
    expect((await env.db.select().from(schema.leadResultHistory)).length).toBeGreaterThan(4);
  });

  it("preserves exact status counts in individual source/responsible rows and the combined Other remainder", async () => {
    const admins = await env.db.insert(schema.adminUsers).values(Array.from({ length: 35 }, (_, index) => ({
      email: `manager-${index}@example.test`, passwordHash: "unused", isTemporary: true,
    }))).returning();
    const fixtures: { status: LeadStatus; source: string; responsible: string }[] = [];
    for (const [index, admin] of admins.entries()) {
      const fixture = { status: LEAD_STATUSES[index % LEAD_STATUSES.length], source: `source-${String(index).padStart(2, "0")}`, responsible: admin.id };
      await candidate(fixture.status, fixture);
      fixtures.push(fixture);
    }
    const report = await getLeadResults(cohort, now);
    expect(report.sources).toHaveLength(30);
    expect(report.responsibles).toHaveLength(30);
    const visibleSources = new Set(report.sources.filter(row => row.kind !== "other").map(row => row.source));
    const visibleAdmins = new Set(report.responsibles.filter(row => row.kind === "admin").map(row => row.admin!.id));
    for (const row of report.sources) {
      const matching = fixtures.filter(fixture => row.kind === "other" ? !visibleSources.has(fixture.source) : row.source === fixture.source);
      expect(row.statuses).toEqual(countStatuses(matching.map(fixture => fixture.status)));
      expect(Object.values(row.statuses).reduce((sum, count) => sum + count, 0)).toBe(row.leads);
    }
    for (const row of report.responsibles) {
      const matching = fixtures.filter(fixture => row.kind === "other" ? !visibleAdmins.has(fixture.responsible) : row.admin?.id === fixture.responsible);
      expect(row.statuses).toEqual(countStatuses(matching.map(fixture => fixture.status)));
      expect(Object.values(row.statuses).reduce((sum, count) => sum + count, 0)).toBe(row.leads);
    }
    for (const status of LEAD_STATUSES) {
      expect(report.sources.reduce((sum, row) => sum + row.statuses[status], 0)).toBe(report.statuses[status]);
      expect(report.responsibles.reduce((sum, row) => sum + row.statuses[status], 0)).toBe(report.statuses[status]);
    }
  });

  it("returns explicit zero counts for every current and legacy status in an empty cohort", async () => {
    const report = await getLeadResults(cohort, now);
    expect(report.statuses).toEqual(Object.fromEntries(LEAD_STATUSES.map(status => [status, 0])));
    expect(report.totals.leads).toBe(0);
  });
});
