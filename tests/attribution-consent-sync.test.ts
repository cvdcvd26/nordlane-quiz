import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { ApiError } from "@/lib/api";
import { COOKIE_CONSENT_EVENT, COOKIE_CONSENT_NAME, writeCookieConsent, type CookieConsent } from "@/lib/cookie-consent";
import { createAttributionConsentSync, observeAttributionConsent } from "@/lib/attribution-consent-sync";
import { collectVisitorAttribution } from "@/lib/visitor-attribution";
import { POST as postAttribution } from "@/app/api/visitor/attribution/route";
import { syncVisitorAttribution } from "@/server/services/visitor-activity";
import { setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.client.close(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const choice = (preferences: boolean, updatedAt = Date.now()): CookieConsent => ({ version: 2, necessary: true, preferences, updatedAt });
function controllerFixture(initial: CookieConsent | null = choice(true)) {
  let consent = initial;
  let visible = true;
  let hasCookie = initial !== null;
  let href = "https://alleybiz.pl/?utm_source=first";
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  const collect = vi.fn(() => collectVisitorAttribution(href, "https://search.example/private?ignored=value"));
  const send = vi.fn<(payload: unknown) => Promise<unknown>>().mockResolvedValue({ ok: true });
  const sync = createAttributionConsentSync({
    readConsent: () => consent, hasConsentCookie: () => hasCookie, collect, send,
    isVisible: () => visible, windowEvents, documentEvents,
  });
  return {
    sync, send, collect, windowEvents, documentEvents,
    choice: (value: CookieConsent | null) => { consent = value; hasCookie = value !== null; windowEvents.dispatchEvent(new Event(COOKIE_CONSENT_EVENT)); },
    href: (value: string) => { href = value; }, visible: (value: boolean) => { visible = value; documentEvents.dispatchEvent(new Event("visibilitychange")); },
  };
}

describe("one shared consent sender", () => {
  it("coalesces multiple surfaces and session-ready signals, with one listener and no duplicate successful retries", async () => {
    const f = controllerFixture();
    const listener = vi.spyOn(f.windowEvents, "addEventListener");
    const stopPolicy = f.sync.observe();
    const stopQuiz = f.sync.observe();
    await f.sync.sessionReady();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls.filter(([event]) => event === COOKIE_CONSENT_EVENT)).toHaveLength(1);
    for (let i = 0; i < 10; i++) f.windowEvents.dispatchEvent(new Event("focus"));
    await f.sync.sync();
    expect(f.send).toHaveBeenCalledTimes(1);
    stopQuiz();
    f.choice(choice(false, Date.now() + 1));
    await f.sync.sync();
    expect(f.send).toHaveBeenLastCalledWith({});
    stopPolicy();
    f.choice(choice(true, Date.now() + 2));
    await Promise.resolve();
    expect(f.send).toHaveBeenCalledTimes(2);
  });

  it("waits for a real session-ready signal after an early401 without creating or polling for a session", async () => {
    vi.useFakeTimers();
    const f = controllerFixture();
    f.send.mockRejectedValueOnce(new ApiError("No visitor session", 401));
    const stop = f.sync.observe();
    await f.sync.sync();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.send).toHaveBeenCalledTimes(1);
    await f.sync.sessionReady();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ utmSource: "first" }));
    stop();
  });

  it("retries transient failures while visible and reads current attribution again instead of marking failure captured", async () => {
    vi.useFakeTimers();
    const f = controllerFixture();
    f.send.mockRejectedValueOnce(new ApiError("Offline", 0));
    const stop = f.sync.observe();
    await f.sync.sync();
    expect(f.send).toHaveBeenCalledTimes(1);
    f.href("https://alleybiz.pl/?utm_source=latest");
    f.visible(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.send).toHaveBeenCalledTimes(1);
    f.visible(true);
    await f.sync.sync();
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ utmSource: "latest" }));
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.send).toHaveBeenCalledTimes(2);
    stop();
  });

  it("withdraws before an old retry and never sends that consented payload again", async () => {
    vi.useFakeTimers();
    const revision = Date.now();
    const f = controllerFixture(choice(true, revision));
    f.send.mockRejectedValueOnce(new ApiError("Temporary server failure", 503));
    const stop = f.sync.observe();
    await f.sync.sync();
    f.choice(choice(false, revision + 1));
    await f.sync.sync();
    expect(f.send.mock.calls.map(([payload]) => payload)).toEqual([expect.objectContaining({ utmSource: "first" }), {}]);
    expect(f.collect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.send).toHaveBeenCalledTimes(2);
    stop();
  });

  it("serializes a withdrawal behind a grant already in flight", async () => {
    const f = controllerFixture();
    let resolveGrant!: () => void;
    f.send.mockImplementationOnce(() => new Promise<void>(resolve => { resolveGrant = resolve; }));
    const stop = f.sync.observe();
    const pending = f.sync.sync();
    await Promise.resolve();
    f.choice(choice(false, Date.now() + 1));
    expect(f.send).toHaveBeenCalledTimes(1);
    resolveGrant();
    await pending;
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send).toHaveBeenLastCalledWith({});
    stop();
  });

  it("avoids requests and URL collection for an unset choice and collects nothing optional on withdrawal", async () => {
    const f = controllerFixture(null);
    const stop = f.sync.observe();
    await Promise.resolve();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.collect).not.toHaveBeenCalled();
    f.choice(choice(false));
    await f.sync.sync();
    expect(f.send).toHaveBeenCalledExactlyOnceWith({});
    expect(f.collect).not.toHaveBeenCalled();
    stop();
  });
});

it("synchronizes policy-page withdrawal through the shared surface and never creates a session on that page", async () => {
  jar.clear();
  const token = randomBytes(32).toString("base64url");
  const [session] = await env.db.insert(schema.visitorSessions).values({ tokenHash: createHash("sha256").update(token).digest("hex") }).returning();
  jar.set("nl_visitor", token);
  await syncVisitorAttribution(session.id, { utmSource: "original", referrerHost: "search.example" }, choice(true, Date.now() - 1000));
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  let raw = "";
  const document = Object.defineProperties(documentEvents, {
    cookie: { get: () => raw, set: (value: string) => {
      raw = value.split(";")[0]; jar.set(COOKIE_CONSENT_NAME, raw.slice(COOKIE_CONSENT_NAME.length + 1));
    } },
    visibilityState: { value: "visible" }, referrer: { value: "https://alleybiz.pl/step-3-task" },
  });
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", Object.assign(windowEvents, {
    location: { href: "https://alleybiz.pl/cookie-policy", protocol: "https:" },
    localStorage: { removeItem: vi.fn() },
  }));
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/visitor/attribution");
    expect(init?.method).toBe("POST");
    return postAttribution(new Request(`https://alleybiz.pl${url}`, { ...init, headers: {
      "content-type": "application/json", host: "alleybiz.pl", origin: "https://alleybiz.pl",
    } }));
  });
  vi.stubGlobal("fetch", fetch);
  writeCookieConsent(true);
  const stop = observeAttributionConsent(); // The same mount effect used by CookieConsent on /cookie-policy.
  try {
    await vi.waitFor(async () => {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await env.db.select().from(schema.visitorAttribution).where(eq(schema.visitorAttribution.sessionId, session.id)))[0].utmSource).toBe("original");
    });
    writeCookieConsent(false);
    await vi.waitFor(async () => {
      expect((await env.db.select().from(schema.visitorAttribution).where(eq(schema.visitorAttribution.sessionId, session.id)))[0]).toMatchObject({ consentAll: false, utmSource: null, referrerHost: null });
    });
    expect(await env.db.select().from(schema.visitorSessions)).toHaveLength(1);
    // A visitor arriving directly at the policy page has no session; changing consent only gets401.
    jar.delete("nl_visitor");
    await env.db.delete(schema.visitorSessions);
    const requestCount = fetch.mock.calls.length;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 10);
    writeCookieConsent(false);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(requestCount + 1));
    expect(await env.db.select().from(schema.visitorSessions)).toEqual([]);
    expect(await env.db.select().from(schema.visitorAttribution)).toEqual([]);
    expect(fetch.mock.calls.every(([url]) => url === "/api/visitor/attribution")).toBe(true);
  } finally { stop(); }
});
