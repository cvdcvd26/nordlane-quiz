import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { LeadResultUpdate } from "@/config/lead-results";
import { getLeadResult, getLeadResults, getLeadResultsSuccesses, updateLeadResult } from "@/server/services/lead-results";
import { setupTestEnv } from "./helpers";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let owner: typeof schema.adminUsers.$inferSelect;
let staff: typeof schema.adminUsers.$inferSelect;
const now = new Date("2026-10-28T12:00:00Z");
const cohort = { period: "custom", from: "2026-10-01", to: "2026-10-07" };
const unchanged: LeadResultUpdate = {
  qualification: "unreviewed", closure: "open", reason: null, comment: "", responsibleAdminId: null, expectedVersion: 0,
};

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

async function lead(createdAt = "2026-10-03T12:00:00Z", sessionCreatedAt = createdAt) {
  const [session] = await env.db.insert(schema.visitorSessions).values({ tokenHash: randomUUID(), createdAt: new Date(sessionCreatedAt) }).returning();
  const [row] = await env.db.insert(schema.leads).values({ sessionId: session.id, createdAt: new Date(createdAt) }).returning();
  return row;
}
async function save(leadId: number, changes: Partial<LeadResultUpdate>, at = now) {
  return updateLeadResult(leadId, owner.id, { ...unchanged, ...changes }, at);
}
async function source(sessionId: string, values: Partial<typeof schema.visitorAttribution.$inferInsert>) {
  await env.db.insert(schema.visitorAttribution).values({ sessionId, ...values });
}

describe("private lead result state and audit", () => {
  it("keeps received data in progress, records transitions and clears a former closing date when reopened", async () => {
    const row = await lead();
    const received = await save(row.id, { closure: "data_received", comment: "Received candidate details" });
    expect(received.result).toMatchObject({ closure: "data_received", qualification: "unreviewed", version: 1, closedAt: null });
    expect(received.history[0]).toMatchObject({ previous: { closure: "open" }, next: received.result });
    const successful = await save(row.id, { closure: "signal_working", expectedVersion: 1 });
    expect(successful.result).toMatchObject({ qualification: "suitable", closure: "signal_working", closedAt: now.toISOString(), version: 2 });
    const reopened = await save(row.id, { qualification: "suitable", closure: "data_received", expectedVersion: 2 });
    expect(reopened.result).toMatchObject({ qualification: "suitable", closure: "data_received", closedAt: null, version: 3 });
    expect(reopened.history).toHaveLength(3);
    await expect(save(row.id, { closure: "data_received", expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it("gives existing leads explicit unreviewed/open defaults without inventing a saved result or audit entry", async () => {
    const row = await lead();
    const detail = await getLeadResult(row.id);
    expect(detail).toMatchObject({ leadId: row.id, hasSavedResult: false, history: [], result: {
      qualification: "unreviewed", closure: "open", reason: null, comment: "", responsibleAdminId: null,
      updatedById: null, updatedAt: null, closedAt: null, version: 0,
    } });
    expect(detail.responsibleAdmins).toEqual(expect.arrayContaining([
      { id: owner.id, email: owner.email }, { id: staff.id, email: staff.email },
    ]));
    expect(await save(row.id, {})).toEqual(detail);
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
    expect(await env.db.select().from(schema.leadResultHistory)).toEqual([]);
    await expect(getLeadResult(9999999)).rejects.toMatchObject({ status: 404 });
  });

  it("records real edits atomically, preserves earlier audit snapshots, and leaves closed dates stable for a no-op", async () => {
    const row = await lead();
    const closed = new Date("2026-10-20T10:00:00Z");
    const first = await save(row.id, { qualification: "suitable", closure: "signal_working", comment: "Private decision", responsibleAdminId: staff.id }, closed);
    expect(first.result).toMatchObject({ qualification: "suitable", closure: "signal_working", version: 1,
      updatedById: owner.id, responsibleAdminId: staff.id, closedAt: closed.toISOString(), updatedAt: closed.toISOString() });
    expect(first.history).toHaveLength(1);
    expect(first.history[0]).toMatchObject({ previous: { version: 0, qualification: "unreviewed", closure: "open" }, next: first.result,
      actor: { id: owner.id, email: owner.email } });
    const same = await save(row.id, { qualification: "suitable", closure: "signal_working", comment: "Private decision", responsibleAdminId: staff.id, expectedVersion: 1 });
    expect(same).toEqual(first);

    const edited = await save(row.id, { qualification: "suitable", closure: "signal_working", comment: "Further private context", responsibleAdminId: staff.id, expectedVersion: 1 });
    expect(edited.result).toMatchObject({ version: 2, closedAt: closed.toISOString(), comment: "Further private context" });
    expect(edited.history).toHaveLength(2);
    expect(edited.history.find(entry => entry.id === first.history[0].id)).toEqual(first.history[0]);
    const reopened = await save(row.id, { qualification: "suitable", expectedVersion: 2 });
    expect(reopened.result).toMatchObject({ closure: "open", closedAt: null, version: 3 });
    expect(await env.db.select().from(schema.leadResultHistory)).toHaveLength(3);
  });

  it("prevents two stale editors from overwriting the same result, including the first save", async () => {
    const row = await lead();
    const results = await Promise.allSettled([
      save(row.id, { qualification: "suitable", comment: "First reviewer" }),
      save(row.id, { qualification: "unsuitable", closure: "not_suitable", reason: "skills", comment: "Second reviewer" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409, code: "lead_result_changed" } });
    const current = await getLeadResult(row.id);
    expect(current.result.version).toBe(1);
    expect(current.history).toHaveLength(1);
    await expect(save(row.id, { qualification: "suitable", comment: "Stale tab" })).rejects.toMatchObject({ status: 409 });
    expect(await getLeadResult(row.id)).toEqual(current);
  });

  it("normalizes business combinations and validates actual responsible accounts without trusting a chat manager ID", async () => {
    const row = await lead();
    const success = await save(row.id, { closure: "signal_working" });
    expect(success.result).toMatchObject({ qualification: "suitable", closure: "signal_working" });
    const rejected = await save(row.id, { closure: "not_suitable", expectedVersion: 1 });
    expect(rejected.result).toMatchObject({ qualification: "unsuitable", closure: "not_suitable" });
    const unsuitable = await save(row.id, { qualification: "unsuitable", expectedVersion: 2 });
    expect(unsuitable.result).toMatchObject({ qualification: "unsuitable", closure: "not_suitable" });
    const before = await getLeadResult(row.id);
    await expect(save(row.id, { qualification: "suitable", expectedVersion: before.result.version, responsibleAdminId: randomUUID() })).rejects.toMatchObject({ status: 400, code: "lead_result_responsible" });
    await expect(save(row.id, { qualification: "suitable", expectedVersion: before.result.version, responsibleAdminId: row.managerId })).rejects.toThrow();
    expect(await getLeadResult(row.id)).toEqual(before);
  });

  it("keeps chat state, the published candidate outcome, and delayed messages unchanged when saving a private result", async () => {
    const row = await lead();
    await env.db.update(schema.leads).set({ status: "rejected", candidateResultBody: "Published candidate feedback", candidateResultPublishedAt: now }).where(eq(schema.leads.id, row.id));
    const [conversation] = await env.db.insert(schema.conversations).values({ sessionId: row.sessionId, leadId: row.id }).returning();
    await env.db.insert(schema.messages).values({ conversationId: conversation.id, sender: "admin", body: "Existing chat", clientMessageId: randomUUID() });
    const [submission] = await env.db.insert(schema.taskSubmissions).values({ sessionId: row.sessionId, idempotencyKey: randomUUID() }).returning();
    await env.db.insert(schema.scheduledMessages).values({ submissionId: submission.id, conversationId: conversation.id, scheduledFor: now });
    const load = async () => ({
      leads: await env.db.select().from(schema.leads), conversations: await env.db.select().from(schema.conversations),
      messages: await env.db.select().from(schema.messages), scheduled: await env.db.select().from(schema.scheduledMessages),
    });
    const before = await load();
    await save(row.id, { qualification: "suitable", closure: "data_received", comment: "PRIVATE_RESULT_CONTEXT", responsibleAdminId: staff.id });
    expect(await load()).toEqual(before);
    expect(env.queued).toEqual([]);
    expect(env.blobs.size).toBe(0);
  });

  it("bounds the visible audit to the latest ten edits while retaining every earlier immutable snapshot", async () => {
    const row = await lead();
    const first = await save(row.id, { qualification: "suitable", comment: "Initial review" });
    for (let version = 1; version < 12; version++) {
      await save(row.id, { qualification: "suitable", comment: `Review ${version + 1}`, expectedVersion: version });
    }
    const detail = await getLeadResult(row.id);
    expect(detail.result.version).toBe(12);
    expect(detail.history.map(entry => entry.next.version)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    const stored = await env.db.select().from(schema.leadResultHistory).where(eq(schema.leadResultHistory.leadId, row.id));
    expect(stored).toHaveLength(12);
    expect(stored.find(entry => entry.version === 1)).toMatchObject({ previous: first.history[0].previous, next: first.result });
  });

  it("retains decisions and snapshots when an operator is deleted, and cascades private history with the lead", async () => {
    const row = await lead();
    const original = await save(row.id, { qualification: "suitable", closure: "signal_working", responsibleAdminId: staff.id });
    await env.db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, staff.id));
    expect((await getLeadResult(row.id)).result).toMatchObject({ responsibleAdminId: null, qualification: "suitable", closure: "signal_working", version: 1 });
    await env.db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, owner.id));
    const retained = await getLeadResult(row.id);
    expect(retained.result).toMatchObject({ updatedById: null, responsibleAdminId: null, version: 1 });
    expect(retained.history[0]).toMatchObject({ actor: null, previous: original.history[0].previous, next: original.result });
    await env.db.delete(schema.leads).where(eq(schema.leads.id, row.id));
    expect(await env.db.select().from(schema.leadResults)).toEqual([]);
    expect(await env.db.select().from(schema.leadResultHistory)).toEqual([]);
  });
});

describe("lead-created Warsaw result cohorts", () => {
  it("counts received data separately without closing the lead, inflating success or adding a loss reason", async () => {
    await lead();
    const received = await lead();
    const success = await lead();
    const declined = await lead();
    await save(received.id, { closure: "data_received", reason: "other" });
    await save(success.id, { closure: "signal_working" });
    await save(declined.id, { closure: "candidate_declined", reason: "candidate_choice" });
    const report = await getLeadResults(cohort, now);
    expect(report.closures).toEqual({ open: 1, data_received: 1, signal_working: 1, not_suitable: 0, candidate_declined: 1, no_contact: 0 });
    expect(report.totals).toMatchObject({ leads: 4, closed: 2, success: 1 });
    expect(report.totals.leads - report.totals.closed).toBe(2);
    expect(report.lossReasons).toEqual([{ reason: "candidate_choice", leads: 1 }]);
    expect(report.rates.successOfAll).toBe(0.25);
    expect(report.daily.reduce((sum, day) => sum + day.success, 0)).toBe(1);
    expect((await getLeadResultsSuccesses(cohort, now)).leads.items.map(item => item.id)).toEqual([success.id]);
  });

  it("uses lead creation and current private results for totals, denominators, sources and responsible filters without join multiplication", async () => {
    const a = await lead("2026-09-30T22:00:00Z", "2026-09-01T12:00:00Z");
    const b = await lead("2026-10-02T12:00:00Z", "2026-10-20T12:00:00Z");
    const c = await lead();
    const d = await lead("2026-10-04T12:00:00Z");
    const e = await lead("2026-10-05T12:00:00Z");
    const f = await lead("2026-10-07T21:59:59.999Z");
    for (const row of [a, b]) await source(row.sessionId, { consentAll: true, utmSource: "google", utmMedium: "cpc", utmCampaign: "hire" });
    await source(d.sessionId, { consentAll: false, utmSource: "PRIVATE_LEGACY_SOURCE", utmCampaign: "PRIVATE_LEGACY_CAMPAIGN", referrerHost: "private.example" });
    await source(e.sessionId, { consentAll: true });
    await source(f.sessionId, { consentAll: true, referrerHost: "jobs.example" });
    await save(a.id, { qualification: "suitable", closure: "signal_working", responsibleAdminId: staff.id });
    await save(a.id, { qualification: "suitable", closure: "signal_working", responsibleAdminId: staff.id, comment: "More audit rows must not multiply leads", expectedVersion: 1 });
    await save(b.id, { qualification: "unsuitable", closure: "not_suitable", reason: "task", responsibleAdminId: staff.id });
    await save(d.id, { qualification: "suitable" });
    await save(e.id, { qualification: "suitable", closure: "candidate_declined", reason: "candidate_choice", responsibleAdminId: owner.id });
    await save(f.id, { closure: "no_contact", reason: "communication" });
    await env.db.insert(schema.visitorContacts).values({ sessionId: a.sessionId, name: "Cohort candidate", phone: "+48600123456" });
    const [conversation] = await env.db.insert(schema.conversations).values({ sessionId: a.sessionId, leadId: a.id }).returning();
    await env.db.insert(schema.messages).values(Array.from({ length: 3 }, (_, i) => ({ conversationId: conversation.id, sender: "admin" as const, body: `Message ${i}`, clientMessageId: randomUUID() })));
    await env.db.insert(schema.files).values(Array.from({ length: 2 }, (_, i) => ({ sessionId: a.sessionId, purpose: "chat" as const, uploadedBy: "visitor" as const, storageKey: randomUUID(), originalName: `${i}.png`, mimeType: "image/png", sizeBytes: 100 })));
    for (const instant of ["2026-09-30T21:59:59.999Z", "2026-10-07T22:00:00Z"]) {
      const outside = await lead(instant, "2026-10-03T12:00:00Z");
      await save(outside.id, { qualification: "suitable", closure: "signal_working" });
    }
    await env.db.insert(schema.visitorSessions).values({ tokenHash: randomUUID(), createdAt: new Date("2026-10-03T12:00:00Z") });

    const report = await getLeadResults(cohort, now);
    expect(report.range).toEqual({ from: "2026-10-01", to: "2026-10-07", timezone: "Europe/Warsaw" });
    expect(report.totals).toEqual({ leads: 6, reviewed: 4, suitable: 3, success: 1, unreviewed: 2, unsuitable: 1, closed: 4, attributed: 4 });
    expect(report.rates.suitableOfReviewed).toBeCloseTo(3 / 4);
    expect(report.rates.successOfAll).toBeCloseTo(1 / 6);
    expect(report.qualifications).toEqual({ unreviewed: 2, suitable: 3, unsuitable: 1 });
    expect(report.closures).toEqual({ open: 2, data_received: 0, signal_working: 1, not_suitable: 1, candidate_declined: 1, no_contact: 1 });
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "utm", source: "google", medium: "cpc", campaign: "hire", leads: 2, reviewed: 2, suitable: 1, success: 1 }),
      expect.objectContaining({ kind: "unknown", source: null, medium: null, campaign: null, leads: 2, reviewed: 1, suitable: 1, success: 0 }),
      expect.objectContaining({ kind: "direct", leads: 1, reviewed: 1, suitable: 1, success: 0 }),
      expect.objectContaining({ kind: "referrer", source: "jobs.example", leads: 1, reviewed: 0, suitable: 0, success: 0 }),
    ]));
    expect(report.responsibles).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "admin", admin: { id: staff.id, email: staff.email }, leads: 2, reviewed: 2, suitable: 1, success: 1 }),
      expect.objectContaining({ kind: "unassigned", admin: null, leads: 3, reviewed: 1, suitable: 1, success: 0 }),
    ]));
    for (const key of ["leads", "reviewed", "suitable", "success"] as const) {
      expect(report.sources.reduce((sum, item) => sum + item[key], 0)).toBe(report.totals[key]);
      expect(report.responsibles.reduce((sum, item) => sum + item[key], 0)).toBe(report.totals[key]);
    }
    expect(report.daily.reduce((sum, day) => sum + day.leads, 0)).toBe(6);
    expect(report.daily.reduce((sum, day) => sum + day.success, 0)).toBe(1);
    expect(report.lossReasons).toEqual(expect.arrayContaining([{ reason: "task", leads: 1 }, { reason: "candidate_choice", leads: 1 }, { reason: "communication", leads: 1 }]));
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_LEGACY|private\.example/);
    expect(report.leads.items.find(item => item.id === c.id)).toMatchObject({ hasSavedResult: false, result: { qualification: "unreviewed", closure: "open" } });

    const google = report.sources.find(item => item.kind === "utm")!;
    const selected = await getLeadResults({ ...cohort, source: google.key!, responsible: staff.id }, now);
    expect(selected.totals).toMatchObject({ leads: 2, reviewed: 2, suitable: 1, success: 1 });
    expect(new Set(selected.leads.items.map(item => item.id))).toEqual(new Set([a.id, b.id]));
    const sourceSelected = await getLeadResults({ ...cohort, source: google.key! }, now);
    expect(sourceSelected.sourceOptions).toEqual(expect.arrayContaining(report.sourceOptions));
    expect(sourceSelected.sourceOptions.map(option => option.kind)).toEqual(expect.arrayContaining(["utm", "unknown", "direct", "referrer"]));
    const unassigned = await getLeadResults({ ...cohort, responsible: "unassigned" }, now);
    expect(unassigned.totals).toMatchObject({ leads: 3, reviewed: 1, suitable: 1, success: 0 });
    expect(new Set(unassigned.leads.items.map(item => item.id))).toEqual(new Set([c.id, d.id, f.id]));
    const unknown = report.sources.find(item => item.kind === "unknown")!;
    expect((await getLeadResults({ ...cohort, source: unknown.key! }, now)).totals.leads).toBe(2);
  });

  it("includes both repeated autumn hours and exactly one spring calendar day at Warsaw boundaries", async () => {
    for (const [date, instants] of [
      ["2026-03-29", ["2026-03-28T22:59:59.999Z", "2026-03-28T23:00:00Z", "2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z", "2026-03-29T21:59:59.999Z", "2026-03-29T22:00:00Z"]],
      ["2026-10-25", ["2026-10-24T21:59:59.999Z", "2026-10-24T22:00:00Z", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "2026-10-25T22:59:59.999Z", "2026-10-25T23:00:00Z"]],
    ] as const) {
      for (const instant of instants) await lead(instant);
      const report = await getLeadResults({ period: "custom", from: date, to: date }, now);
      expect(report.totals.leads).toBe(4);
      expect(report.daily).toEqual([{ date, leads: 4, success: 0 }]);
      expect(report.leads.total).toBe(4);
    }
  });

  it("paginates a stable lead cohort independently of totals and returns honest empty denominators", async () => {
    const empty = await getLeadResults(cohort, now);
    expect(empty.totals).toEqual({ leads: 0, reviewed: 0, suitable: 0, success: 0, unreviewed: 0, unsuitable: 0, closed: 0, attributed: 0 });
    expect(empty.rates).toEqual({ suitableOfReviewed: null, successOfAll: null });
    expect(empty.leads).toMatchObject({ total: 0, items: [] });
    expect(empty.sources).toEqual([]);
    const rows = [];
    for (let i = 0; i < 5; i++) rows.push(await lead());
    const pages = await Promise.all(["1", "2", "3"].map(page => getLeadResults({ ...cohort, page, pageSize: "2" }, now)));
    expect(pages.map(page => page.leads.items.length)).toEqual([2, 2, 1]);
    for (const page of pages) {
      expect(page.totals.leads).toBe(5);
      expect(page.rates.suitableOfReviewed).toBeNull();
      expect(page.rates.successOfAll).toBe(0);
      expect(page.leads).toMatchObject({ total: 5, pageSize: 2, pages: 3 });
    }
    expect(pages.flatMap(page => page.leads.items.map(item => item.id))).toEqual(rows.map(row => row.id).reverse());
  });

  it("caps large source and responsible tables with an honest remainder and keeps source options usable after filtering", async () => {
    const operators = await env.db.insert(schema.adminUsers).values(Array.from({ length: 33 }, (_, i) => ({ email: `operator-${i}@example.test`, passwordHash: "unused", isTemporary: true }))).returning();
    const admins = [owner, staff, ...operators];
    for (let i = 0; i < 35; i++) {
      const row = await lead();
      await source(row.sessionId, { consentAll: true, utmSource: `source-${i}` });
      await save(row.id, { qualification: "suitable", closure: i === 0 ? "signal_working" : "open", responsibleAdminId: admins[i].id });
    }
    const report = await getLeadResults(cohort, now);
    expect(report.sources).toHaveLength(30);
    expect(report.responsibles).toHaveLength(30);
    expect(report.sourceOptions).toHaveLength(30);
    expect(report.sources.find(row => row.kind === "other")).toMatchObject({ key: null, leads: 6 });
    expect(report.responsibles.find(row => row.kind === "other")).toMatchObject({ admin: null, leads: 6 });
    for (const key of ["leads", "reviewed", "suitable", "success"] as const) {
      expect(report.sources.reduce((sum, row) => sum + row[key], 0)).toBe(report.totals[key]);
      expect(report.responsibles.reduce((sum, row) => sum + row[key], 0)).toBe(report.totals[key]);
    }
    const option = report.sourceOptions.find(option => !report.sources.some(row => row.source === option.source))!;
    expect(option).toBeDefined();
    const filtered = await getLeadResults({ ...cohort, source: option.key }, now);
    expect(filtered.totals.leads).toBe(1);
    expect(filtered.sourceOptions).toHaveLength(30);
    expect(filtered.sourceOptions).toContainEqual(option);
    expect(filtered.sources).toHaveLength(1);
    expect(filtered.leads.total).toBe(1);
  });
});
