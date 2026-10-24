import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { COOKIE_CONSENT_NAME } from "@/lib/cookie-consent";
import { POST as postActivity } from "@/app/api/visitor/activity/route";
import { POST as postAttribution } from "@/app/api/visitor/attribution/route";
import { GET as getAnalytics } from "@/app/api/admin/analytics/route";
import { saveAnswer } from "@/server/services/quiz";
import { setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
const sessionSecret = "analytics-test-secret-with-at-least-thirty-two-characters";
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  jar.clear();
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.appSettings);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.rateLimits);
  vi.stubEnv("ADMIN_SESSION_SECRET", sessionSecret);
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

function request(path: string, body: unknown, origin = "https://example.com") {
  return new Request(`https://example.com${path}`, { method: "POST", headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function visitor() {
  const token = randomBytes(32).toString("base64url");
  const [row] = await env.db.insert(schema.visitorSessions).values({
    tokenHash: createHash("sha256").update(token).digest("hex"), lastSeenAt: new Date(Date.now() - 60_000),
  }).returning();
  return { token, sid: row.id, lastSeenAt: row.lastSeenAt };
}
function consent(preferences: boolean, updatedAt = Date.now()) {
  jar.set(COOKIE_CONSENT_NAME, encodeURIComponent(JSON.stringify({ version: 2, necessary: true, preferences, updatedAt })));
}
async function attribution(sid: string) {
  return (await env.db.select().from(schema.visitorAttribution).where(eq(schema.visitorAttribution.sessionId, sid)))[0];
}

describe("private first-party telemetry API boundaries", () => {
  it("requires an existing session and never creates one for a missing or invalid visitor cookie", async () => {
    for (const token of [undefined, "invalid-cookie", randomBytes(32).toString("base64url")]) {
      if (token) jar.set("nl_visitor", token); else jar.delete("nl_visitor");
      expect((await postActivity(request("/api/visitor/activity", { visible: true }))).status).toBe(401);
      expect((await postAttribution(request("/api/visitor/attribution", { utmSource: "search" }))).status).toBe(401);
    }
    expect(await env.db.select().from(schema.visitorSessions)).toEqual([]);
    expect(await env.db.select().from(schema.visitorAttribution)).toEqual([]);
  });

  it("keeps necessary activity separate from optional consent and isolates both endpoints to the authenticated session", async () => {
    const a = await visitor();
    const b = await visitor();
    jar.set("nl_visitor", a.token);
    expect((await postAttribution(request("/api/visitor/attribution", { utmSource: "not-consented" }))).status).toBe(200);
    expect(await attribution(a.sid)).toBeUndefined();
    jar.set(COOKIE_CONSENT_NAME, encodeURIComponent(JSON.stringify({ version: 1, necessary: true, preferences: true, updatedAt: Date.now() })));
    expect((await postAttribution(request("/api/visitor/attribution", { utmSource: "old-sound-only-consent" }))).status).toBe(200);
    expect(await attribution(a.sid)).toBeUndefined();
    expect((await postActivity(request("/api/visitor/activity", { visible: true }))).status).toBe(200);
    const sessions = await env.db.select().from(schema.visitorSessions);
    expect(sessions.find(row => row.id === a.sid)!.lastSeenAt.getTime()).toBeGreaterThan(a.lastSeenAt.getTime());
    expect(sessions.find(row => row.id === b.sid)!.lastSeenAt).toEqual(b.lastSeenAt);
    const revision = Date.now() - 1000;
    consent(true, revision);
    expect((await postAttribution(request("/api/visitor/attribution", { utmSource: "search", referrerHost: "search.example" }))).status).toBe(200);
    expect(await attribution(a.sid)).toMatchObject({ consentAll: true, utmSource: "search", referrerHost: "search.example" });
    expect(await attribution(b.sid)).toBeUndefined();
    consent(false, revision + 1);
    expect((await postAttribution(request("/api/visitor/attribution", { utmSource: "ignored" }))).status).toBe(200);
    expect(await attribution(a.sid)).toMatchObject({ consentAll: false, utmSource: null, referrerHost: null });
    consent(true, revision);
    await postAttribution(request("/api/visitor/attribution", { utmSource: "stale-request" }));
    expect(await attribution(a.sid)).toMatchObject({ consentAll: false, utmSource: null });
  });

  it("rejects hidden presence, forged session IDs, cross-site writes and unverified task views", async () => {
    const a = await visitor();
    const b = await visitor();
    jar.set("nl_visitor", a.token);
    for (const input of [{ visible: false }, { visible: true, sessionId: b.sid }, { visible: true, utmSource: "hidden-source" }])
      expect((await postActivity(request("/api/visitor/activity", input))).status).toBe(400);
    expect((await postActivity(request("/api/visitor/activity", { visible: true }, "https://other.example"))).status).toBe(403);
    expect((await postAttribution(request("/api/visitor/attribution", {}, "https://other.example"))).status).toBe(403);
    expect((await postActivity(request("/api/visitor/activity", { visible: true, taskViewed: true }))).status).toBe(409);
    expect(await attribution(a.sid)).toBeUndefined();
    await env.db.insert(schema.visitorContacts).values({ sessionId: a.sid, name: "Verified", phone: "+48600123456" });
    for (const key of ["q1", "q2", "q3"]) await saveAnswer(a.sid, key, "yes");
    expect((await postActivity(request("/api/visitor/activity", { visible: true, taskViewed: true }))).status).toBe(200);
    expect((await attribution(a.sid))!.taskViewedAt).toBeInstanceOf(Date);
    expect((await attribution(a.sid))!.consentAll).toBe(false);
    expect(await attribution(b.sid)).toBeUndefined();
  });

  it("validates consented input before storage and limits repeated requests", async () => {
    const { token, sid } = await visitor();
    jar.set("nl_visitor", token);
    consent(true);
    for (const input of [
      { referrerHost: "https://example.com/private?email=a@example.com" },
      { referrerHost: "example.com/path" }, { utmSource: "x".repeat(121) },
      { utmSource: "source", gclid: "advertising-id" }, { sessionId: sid },
    ]) expect((await postAttribution(request("/api/visitor/attribution", input))).status).toBe(400);
    expect(await attribution(sid)).toBeUndefined();
    for (let i = 0; i < 30; i++) await postActivity(request("/api/visitor/activity", { visible: true }));
    const limited = await postActivity(request("/api/visitor/activity", { visible: true }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "rate_limited" });
  });

  it("stops before payload, session, rate-limit and attribution effects during maintenance", async () => {
    const { token, sid, lastSeenAt } = await visitor();
    jar.set("nl_visitor", token);
    consent(true);
    await env.db.insert(schema.appSettings).values({ key: "maintenanceEnabled", value: true });
    for (const response of [
      await postActivity(request("/api/visitor/activity", { visible: true })),
      await postAttribution(request("/api/visitor/attribution", { utmSource: "search" })),
    ]) {
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("60");
    }
    expect(await env.db.select().from(schema.rateLimits)).toEqual([]);
    expect(await attribution(sid)).toBeUndefined();
    expect((await env.db.select().from(schema.visitorSessions).where(eq(schema.visitorSessions.id, sid)))[0].lastSeenAt).toEqual(lastSeenAt);
  });

  it("does not expose or log attribution values when the database driver fails", async () => {
    const { token } = await visitor();
    jar.set("nl_visitor", token);
    consent(true);
    const driver = vi.spyOn(env.db, "transaction").mockRejectedValueOnce(new Error("insert failed; params: private-campaign-label"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await postAttribution(request("/api/visitor/attribution", { utmCampaign: "private-campaign-label" }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: "attribution_unavailable", error: "Source data could not be saved." });
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      driver.mockRestore();
      errorLog.mockRestore();
    }
  });

  it("authenticates the aggregate admin report and validates bounded ranges", async () => {
    const req = (query = "") => new Request(`https://example.com/api/admin/analytics${query}`);
    expect((await getAnalytics(req())).status).toBe(401);
    const [admin] = await env.db.insert(schema.adminUsers).values({ email: "analytics@example.com", passwordHash: "unused", isTemporary: true }).returning();
    jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(sessionSecret)));
    const response = await getAnalytics(req());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ totals: { sessions: 0, submitted: 0 }, sources: [] });
    expect((await getAnalytics(req("?period=custom&from=2024-01-01&to=2025-01-01"))).status).toBe(400);
    expect((await getAnalytics(req("?period=all"))).status).toBe(400);
  });
});
