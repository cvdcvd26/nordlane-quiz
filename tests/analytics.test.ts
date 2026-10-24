import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { getAnalytics, parseAnalyticsRange } from "@/server/services/analytics";
import { recordVisitorActivity, syncVisitorAttribution } from "@/server/services/visitor-activity";
import { saveAnswer } from "@/server/services/quiz";
import { collectVisitorAttribution } from "@/lib/visitor-attribution";
import type { CookieConsent } from "@/lib/cookie-consent";
import { setupTestEnv } from "./helpers";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => { await env.db.delete(schema.visitorSessions); });
afterAll(async () => { await env.client.close(); });

const choice = (preferences: boolean, updatedAt = Date.now()): CookieConsent => ({ version: 2, necessary: true, preferences, updatedAt });
async function session(createdAt = new Date(), lastSeenAt = createdAt) {
  const [row] = await env.db.insert(schema.visitorSessions).values({ tokenHash: randomUUID(), createdAt, lastSeenAt }).returning();
  return row.id;
}
async function prerequisites(sid: string) {
  await env.db.insert(schema.visitorContacts).values({ sessionId: sid, name: "Analytics candidate", phone: "+48600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
}
async function attribution(sid: string) {
  const [row] = await env.db.select().from(schema.visitorAttribution).where(eq(schema.visitorAttribution.sessionId, sid));
  return row;
}

describe("bounded Warsaw calendar analytics cohorts", () => {
  it("validates real calendar dates, inclusive end boundaries, future dates and the 366-day cap", () => {
    const now = new Date("2026-10-24T12:00:00Z");
    expect(parseAnalyticsRange({ period: "7d" }, now).labels).toEqual({ from: "2026-10-18", to: "2026-10-24", timezone: "Europe/Warsaw" });
    expect(parseAnalyticsRange({ period: "custom", from: "2024-01-01", to: "2024-12-31" }, now).end.toISOString()).toBe("2024-12-31T23:00:00.000Z");
    for (const input of [
      { period: "custom", from: "2026-02-30", to: "2026-03-01" },
      { period: "custom", from: "2026-10-24", to: "2026-10-23" },
      { period: "custom", from: "2024-01-01", to: "2025-01-01" },
      { period: "custom", from: "2026-10-24", to: "2026-10-25" },
      { period: "custom", from: "2026-10-24T00:00:00Z", to: "2026-10-24" },
      { period: "custom", from: "0000-01-01", to: "0000-01-02" },
      { period: "custom" }, { period: "all" }, { period: "30d", sessionId: randomUUID() },
    ]) expect(() => parseAnalyticsRange(input, now)).toThrow();
  });

  it("uses Poland's current calendar date for presets and accepts today shortly after local midnight", () => {
    const now = new Date("2026-10-23T22:30:00Z"); // 00:30 on 24 October in Warsaw.
    for (const [period, from] of [["7d", "2026-10-18"], ["30d", "2026-09-25"], ["90d", "2026-07-27"]])
      expect(parseAnalyticsRange({ period }, now).labels).toEqual({ from, to: "2026-10-24", timezone: "Europe/Warsaw" });
    const today = parseAnalyticsRange({ period: "custom", from: "2026-10-24", to: "2026-10-24" }, now);
    expect(today.from.toISOString()).toBe("2026-10-23T22:00:00.000Z");
    expect(today.end.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(() => parseAnalyticsRange({ period: "custom", from: "2026-10-25", to: "2026-10-25" }, now)).toThrow();
    const winter = parseAnalyticsRange({ period: "7d" }, new Date("2026-01-23T23:30:00Z"));
    expect(winter.labels.to).toBe("2026-01-24");
    expect(winter.end.toISOString()).toBe("2026-01-24T23:00:00.000Z");
  });

  it("resolves spring and autumn DST days independently and caps calendar days rather than elapsed hours", () => {
    const spring = parseAnalyticsRange({ period: "custom", from: "2026-03-29", to: "2026-03-29" }, new Date("2026-03-30T12:00:00Z"));
    expect(spring.from.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(spring.end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(spring.end.getTime() - spring.from.getTime()).toBe(23 * 3600000);
    const autumn = parseAnalyticsRange({ period: "custom", from: "2026-10-25", to: "2026-10-25" }, new Date("2026-10-26T12:00:00Z"));
    expect(autumn.from.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(autumn.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(autumn.end.getTime() - autumn.from.getTime()).toBe(25 * 3600000);
    const seven = parseAnalyticsRange({ period: "7d" }, new Date("2026-03-29T12:00:00Z"));
    expect(seven.labels.from).toBe("2026-03-23");
    expect(seven.end.getTime() - seven.from.getTime()).toBe((7 * 24 - 1) * 3600000);
    const max = parseAnalyticsRange({ period: "custom", from: "2025-10-25", to: "2026-10-25" }, new Date("2026-10-26T12:00:00Z"));
    expect(max.end.getTime() - max.from.getTime()).toBe((366 * 24 + 1) * 3600000);
  });

  it("uses one session-created cohort for every milestone and source, including milestones saved later", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const complete = await session(new Date("2026-09-30T22:00:00Z"));
    await prerequisites(complete);
    await syncVisitorAttribution(complete, { utmSource: "google", utmMedium: "cpc", utmCampaign: "october" }, choice(true));
    await recordVisitorActivity(complete, { visible: true, taskViewed: true }, choice(true), new Date("2026-10-02T12:00:00Z"));
    await env.db.insert(schema.taskSubmissions).values({ sessionId: complete, idempotencyKey: randomUUID(), submittedAt: new Date("2026-10-08T10:00:00Z") });
    const partial = await session(new Date("2026-10-07T21:59:59.999Z"), new Date(now.getTime() - 30_000));
    await env.db.insert(schema.visitorContacts).values({ sessionId: partial, name: "Partial", phone: "+48600123457" });
    await saveAnswer(partial, "q1", "yes");
    await env.db.insert(schema.quizAnswers).values({ sessionId: partial, questionKey: "removed_question", answer: "yes" });
    const direct = await session(new Date("2026-10-04T12:00:00Z"));
    await syncVisitorAttribution(direct, {}, choice(true));
    for (const at of ["2026-09-30T21:59:59.999Z", "2026-10-07T22:00:00Z"]) {
      const outside = await session(new Date(at));
      await prerequisites(outside);
      await env.db.insert(schema.taskSubmissions).values({ sessionId: outside, idempotencyKey: randomUUID() });
    }
    const report = await getAnalytics({ period: "custom", from: "2026-10-01", to: "2026-10-07" }, now);
    expect(report.totals).toEqual({ sessions: 3, contacts: 2, questions: 1, taskViewed: 1, submitted: 1, attributed: 2, active: 1 });
    expect(report.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "utm", source: "google", medium: "cpc", campaign: "october", sessions: 1, submitted: 1 }),
      expect.objectContaining({ kind: "direct", sessions: 1, submitted: 0 }),
      expect.objectContaining({ kind: "unknown", sessions: 1, contacts: 1, questions: 0 }),
    ]));
    for (const key of ["sessions", "contacts", "questions", "taskViewed", "submitted"] as const)
      expect(report.sources.reduce((sum, row) => sum + row[key], 0)).toBe(report.totals[key]);
  });

  it("includes exactly the Warsaw DST day, including both occurrences of the autumn repeated hour", async () => {
    for (const [date, instants, now] of [
      ["2026-03-29", ["2026-03-28T22:59:59.999Z", "2026-03-28T23:00:00Z", "2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z", "2026-03-29T21:59:59.999Z", "2026-03-29T22:00:00Z"], "2026-03-30T12:00:00Z"],
      ["2026-10-25", ["2026-10-24T21:59:59.999Z", "2026-10-24T22:00:00Z", "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "2026-10-25T22:59:59.999Z", "2026-10-25T23:00:00Z"], "2026-10-26T12:00:00Z"],
    ] as const) {
      for (const instant of instants) await session(new Date(instant));
      const report = await getAnalytics({ period: "custom", from: date, to: date }, new Date(now));
      expect(report.range).toEqual({ from: date, to: date, timezone: "Europe/Warsaw" });
      expect(report.totals.sessions).toBe(4);
      expect(report.sources).toEqual([expect.objectContaining({ kind: "unknown", sessions: 4 })]);
    }
  });

  it("bounds source groups without losing totals and returns honest zero states", async () => {
    expect((await getAnalytics({ period: "30d" })).totals.sessions).toBe(0);
    expect((await getAnalytics({ period: "30d" })).sources).toEqual([]);
    for (let i = 0; i < 35; i++) {
      const sid = await session(new Date("2026-09-01T12:00:00Z"));
      await syncVisitorAttribution(sid, { utmSource: `source-${i}`, utmCampaign: "campaign" }, choice(true));
    }
    const report = await getAnalytics({ period: "custom", from: "2026-09-01", to: "2026-09-01" }, new Date("2026-09-02T00:00:00Z"));
    expect(report.totals.sessions).toBe(35);
    expect(report.sources).toHaveLength(30);
    expect(report.sources.find(row => row.kind === "other")?.sessions).toBe(6);
    expect(report.sources.reduce((sum, row) => sum + row.sessions, 0)).toBe(35);
  });

  it("does not infer historical task views from a submission", async () => {
    const sid = await session();
    await prerequisites(sid);
    await env.db.insert(schema.taskSubmissions).values({ sessionId: sid, idempotencyKey: randomUUID() });
    expect((await getAnalytics({})).totals).toMatchObject({ sessions: 1, contacts: 1, questions: 1, taskViewed: 0, submitted: 1, attributed: 0 });
  });
});

describe("consented source attribution and necessary activity", () => {
  it("collects only UTM labels and an external host, excluding full referrers and advertising IDs", () => {
    const input = collectVisitorAttribution("https://alleybiz.pl/contact?utm_source=search&gclid=advertising-id&fbclid=also-advertising&utm_campaign=hire", "https://search.example/path?private=query#secret");
    expect(input).toEqual({ utmSource: "search", utmCampaign: "hire", utmMedium: null, utmContent: null, utmTerm: null, referrerHost: "search.example" });
    expect(JSON.stringify(input)).not.toMatch(/advertising|private|secret|https:/);
    expect(collectVisitorAttribution("https://alleybiz.pl/task", "https://alleybiz.pl/contact?private=x").referrerHost).toBeNull();
    expect(collectVisitorAttribution("https://alleybiz.pl/task", "javascript:alert(1)").referrerHost).toBeNull();
  });

  it("preserves first attribution and removes it on withdrawal, retaining the verified operational task view", async () => {
    const sid = await session();
    const revision = Date.now() - 1000;
    await syncVisitorAttribution(sid, { utmSource: "not-permitted", referrerHost: "example.com" }, null);
    expect(await attribution(sid)).toBeUndefined();
    await syncVisitorAttribution(sid, { utmSource: "first", utmContent: "creative-a", referrerHost: "example.com" }, choice(true, revision));
    await syncVisitorAttribution(sid, { utmSource: "second" }, choice(true, revision));
    expect(await attribution(sid)).toMatchObject({ consentAll: true, utmSource: "first", utmContent: "creative-a" });
    await prerequisites(sid);
    await recordVisitorActivity(sid, { visible: true, taskViewed: true }, choice(true, revision));
    const viewedAt = (await attribution(sid))!.taskViewedAt;
    await syncVisitorAttribution(sid, { utmSource: "ignored" }, choice(false, revision + 1));
    expect(await attribution(sid)).toMatchObject({ consentAll: false, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, referrerHost: null, taskViewedAt: viewedAt });
    await syncVisitorAttribution(sid, { utmSource: "stale" }, choice(true, revision));
    await syncVisitorAttribution(sid, { utmSource: "same-time-stale" }, choice(true, revision + 1));
    expect(await attribution(sid)).toMatchObject({ consentAll: false, utmSource: null });
    await syncVisitorAttribution(sid, {}, choice(true, revision + 2));
    expect(await attribution(sid)).toMatchObject({ consentAll: true, utmSource: null, taskViewedAt: viewedAt });
  });

  it("requires actual contact and every valid current answer before recording a task view", async () => {
    const sid = await session();
    const task = { visible: true, taskViewed: true };
    await expect(recordVisitorActivity(sid, task, null)).rejects.toMatchObject({ code: "task_prerequisites" });
    await env.db.insert(schema.visitorContacts).values({ sessionId: sid, name: "Candidate", phone: "+48600123456" });
    for (const key of ["q1", "q2"]) await saveAnswer(sid, key, "yes");
    await env.db.insert(schema.quizAnswers).values({ sessionId: sid, questionKey: "q3", answer: "forged-invalid-answer" });
    await expect(recordVisitorActivity(sid, task, null)).rejects.toMatchObject({ code: "task_prerequisites" });
    expect(await attribution(sid)).toBeUndefined();
    await saveAnswer(sid, "q3", "yes");
    await recordVisitorActivity(sid, task, null);
    const first = (await attribution(sid))!.taskViewedAt;
    await recordVisitorActivity(sid, task, null, new Date(Date.now() + 1000));
    expect((await attribution(sid))!.taskViewedAt).toEqual(first);
    expect((await attribution(sid))!.consentAll).toBe(false);
  });

  it("throttles operational lastSeenAt to 30 seconds and updates no other session or optional data", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60_000);
    const sid = await session(old);
    const other = await session(old);
    await recordVisitorActivity(sid, { visible: true }, null, now);
    await recordVisitorActivity(sid, { visible: true }, null, new Date(now.getTime() + 10_000));
    const load = async (id: string) => (await env.db.select().from(schema.visitorSessions).where(eq(schema.visitorSessions.id, id)))[0];
    expect((await load(sid)).lastSeenAt).toEqual(now);
    expect((await load(other)).lastSeenAt).toEqual(old);
    expect(await attribution(sid)).toBeUndefined();
    await expect(recordVisitorActivity(sid, { visible: false }, null)).rejects.toThrow();
    await expect(recordVisitorActivity(sid, { visible: true, sessionId: other }, null)).rejects.toThrow();
    await recordVisitorActivity(sid, { visible: true }, null, new Date(now.getTime() + 30_000));
    expect((await load(sid)).lastSeenAt).toEqual(new Date(now.getTime() + 30_000));
    await syncVisitorAttribution(sid, { utmSource: "permitted" }, choice(true, now.getTime() - 1000));
    await recordVisitorActivity(sid, { visible: true }, null);
    expect(await attribution(sid)).toMatchObject({ consentAll: false, utmSource: null });
  });
});
