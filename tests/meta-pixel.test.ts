import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketingScope } from "@/server/marketing-scope";

const paths = ["/", "/step-2", "/step-3-task", "/step-4-confirmation"];
const scope = marketingScope("visitor-a");
let browser: Window;
let consent: typeof import("@/lib/cookie-consent");
let tracker: typeof import("@/lib/meta-pixel");
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
type TestPixel = ((...args: unknown[]) => void) & { callMethod?: ReturnType<typeof vi.fn>; disablePushState?: boolean };
const fbq = () => (browser as unknown as { fbq: TestPixel }).fbq;
const script = () => browser.document.getElementById("alleybiz-meta-pixel")!;
function sdkReady() {
  const calls = vi.fn();
  fbq().callMethod = calls;
  script().dispatchEvent(new browser.Event("load"));
  return calls;
}
function enter(step: 0 | 1 | 2 | 3, visitor = scope) {
  browser.history.replaceState({}, "", paths[step]);
  tracker.updateMetaQuizStage({ scope: visitor, step, progress: {
    contactSaved: step >= 1, questionsComplete: step >= 2, submitted: step >= 3,
  } });
}

beforeEach(async () => {
  vi.resetModules();
  browser = new Window({ url: "https://alleybiz.vercel.app/", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  vi.stubGlobal("window", browser); vi.stubGlobal("document", browser.document);
  vi.stubGlobal("Event", browser.Event);
  vi.stubGlobal("navigator", {}); vi.stubGlobal("localStorage", browser.localStorage);
  const append = browser.document.head.appendChild.bind(browser.document.head);
  vi.spyOn(browser.document.head, "appendChild").mockImplementation((node) => {
    // Stub the third-party transport only; load/error are driven explicitly below.
    if (node instanceof browser.HTMLScriptElement) node.type = "application/json";
    return append(node);
  });
  consent = await import("@/lib/cookie-consent");
  tracker = await import("@/lib/meta-pixel");
});
afterEach(async () => { await browser.happyDOM.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("consented Meta quiz funnel", () => {
  it("does not load Meta or persist markers for missing, necessary-only, internal-only, or legacy consent", async () => {
    enter(0); await flush(); expect(script()).toBeNull();
    consent.writeCookieConsent(false, false); await flush(); expect(script()).toBeNull();
    consent.writeCookieConsent(true, false); await flush(); expect(script()).toBeNull();
    browser.document.cookie = `${consent.COOKIE_CONSENT_NAME}=${encodeURIComponent(JSON.stringify({ version: 2, necessary: true, preferences: true, updatedAt: Date.now() }))}; Path=/`;
    enter(2); await flush(); expect(script()).toBeNull();
    expect(browser.localStorage.length).toBe(0);
  });

  it("emits all four saved stages and virtual PageViews exactly once, with no private payload", async () => {
    consent.writeCookieConsent(false, true);
    enter(0);
    const calls = sdkReady(); await flush();
    expect(fbq().disablePushState).toBe(true);
    expect(calls.mock.calls.slice(0,5)).toEqual([
      ["consent", "revoke"], ["set", "autoConfig", false, "1823278402432437"],
      ["optOut", "1823278402432437", "AutomaticMatching"], ["init", "1823278402432437"], ["consent", "grant"],
    ]);
    for (const step of [1,2,3] as const) { enter(step); await flush(); }
    // Strict Mode cleanup/remount and browser Back/Forward never repeat conversion events.
    tracker.updateMetaQuizStage(null); enter(2); await flush(); enter(3); await flush();
    expect(calls.mock.calls.filter(([method]) => method === "trackSingleCustom")).toEqual([
      ["trackSingleCustom", "1823278402432437", "LandingView", { step: 1 }],
      ["trackSingleCustom", "1823278402432437", "ContactCompleted", { step: 2 }],
      ["trackSingleCustom", "1823278402432437", "QuizCompleted", { step: 3 }],
      ["trackSingleCustom", "1823278402432437", "TaskSubmitted", { step: 4 }],
    ]);
    expect(calls.mock.calls.filter(([method]) => method === "trackSingle")).toHaveLength(4);
    expect(JSON.stringify(calls.mock.calls)).not.toContain(scope);
    expect(browser.localStorage.length).toBe(4);
  });

  it("does not count a direct future URL or an optimistic answer before its save succeeds", async () => {
    consent.writeCookieConsent(true, true);
    browser.history.replaceState({}, "", "/step-3-task");
    tracker.updateMetaQuizStage({ scope, step: 2, progress: { contactSaved: true, questionsComplete: false, submitted: false } });
    await flush(); expect(script()).toBeNull();
    tracker.updateMetaQuizStage({ scope, step: 1, progress: { contactSaved: true, questionsComplete: false, submitted: false } });
    await flush(); expect(script()).toBeNull(); // resolved state and address must agree
    enter(2); const calls = sdkReady(); await flush();
    expect(calls).toHaveBeenCalledWith("trackSingleCustom", "1823278402432437", "QuizCompleted", { step: 3 });
  });

  it("records the current stage on late opt-in, without replaying earlier unconsented steps", async () => {
    enter(2); await flush(); expect(script()).toBeNull();
    consent.writeCookieConsent(true, true);
    const calls = sdkReady(); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom").map((c) => c[2])).toEqual(["QuizCompleted"]);
  });

  it("cancels tracking when consent is revoked while the SDK is downloading", async () => {
    consent.writeCookieConsent(true, true); enter(2);
    consent.writeCookieConsent(true, false);
    const calls = sdkReady(); await flush();
    expect(calls.mock.calls.filter(([m]) => String(m).startsWith("track"))).toHaveLength(0);
    expect(browser.localStorage.length).toBe(0);
  });

  it("withdraws consent on the policy page, clears only Meta storage, and stops future events", async () => {
    consent.writeCookieConsent(true, true); enter(1); const calls = sdkReady(); await flush();
    browser.document.cookie = "_fbp=test; Path=/"; browser.document.cookie = "_fbc=click; Path=/";
    browser.document.cookie = "nl_visitor=keep; Path=/";
    browser.localStorage.setItem("other", "keep");
    tracker.updateMetaQuizStage(null);
    browser.history.replaceState({}, "", "/cookie-policy");
    consent.writeCookieConsent(true, false); await flush();
    expect(browser.document.cookie).not.toMatch(/_fb[pc]=/);
    expect(browser.document.cookie).toContain("nl_visitor=keep");
    expect(browser.localStorage.length).toBe(1); expect(browser.localStorage.getItem("other")).toBe("keep");
    enter(2); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toHaveLength(1);
    expect(calls).toHaveBeenCalledWith("consent", "revoke");
  });

  it("survives reload deduplication while allowing another application in the same browser", async () => {
    consent.writeCookieConsent(true, true); enter(2); sdkReady(); await flush();
    vi.resetModules(); tracker = await import("@/lib/meta-pixel");
    script().remove(); enter(2); const calls = sdkReady(); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toHaveLength(0);
    enter(2, marketingScope("visitor-b")); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toHaveLength(1);
  });

  it("keeps PageViews on email account restoration without replaying completed conversions", async () => {
    consent.writeCookieConsent(true, true);
    browser.history.replaceState({}, "", paths[3]);
    tracker.updateMetaQuizStage({ scope, step: 3, progress: { contactSaved: true, questionsComplete: true, submitted: true }, restoredThrough: 3 });
    const calls = sdkReady(); await flush();
    expect(calls).toHaveBeenCalledWith("trackSingle", "1823278402432437", "PageView");
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toHaveLength(0);
    expect(browser.localStorage.length).toBe(0);
  });

  it("counts a newly submitted task after email login restored only the questions", async () => {
    consent.writeCookieConsent(true, true);
    browser.history.replaceState({}, "", paths[2]);
    tracker.updateMetaQuizStage({ scope, step: 2, progress: { contactSaved: true, questionsComplete: true, submitted: false }, restoredThrough: 2 });
    const calls = sdkReady(); await flush();
    browser.history.replaceState({}, "", paths[3]);
    tracker.updateMetaQuizStage({ scope, step: 3, progress: { contactSaved: true, questionsComplete: true, submitted: true }, restoredThrough: 2 });
    await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toEqual([
      ["trackSingleCustom", "1823278402432437", "TaskSubmitted", { step: 4 }],
    ]);
  });

  it("does not save a marker on script failure and can retry on a later visit", async () => {
    consent.writeCookieConsent(true, true); enter(2);
    script().dispatchEvent(new browser.Event("error")); await flush();
    expect(browser.localStorage.length).toBe(0);
    enter(2); const calls = sdkReady(); await flush();
    expect(calls).toHaveBeenCalledWith("trackSingleCustom", "1823278402432437", "QuizCompleted", { step: 3 });
  });

  it("scopes Web Locks to the same session and step for parallel-tab deduplication", async () => {
    const request = vi.fn(async (_name: string, callback: () => void) => callback());
    vi.stubGlobal("navigator", { locks: { request } });
    consent.writeCookieConsent(true, true); enter(2); sdkReady(); await flush();
    expect(request).toHaveBeenCalledWith(`ab-meta:${scope}:2`, expect.any(Function));
  });

  it.each([0, 1, 2, 3] as const)("keeps stage %i when an equivalent React effect replaces a waiting lock", async (step) => {
    const release: (() => void)[] = [];
    const request = vi.fn((_name: string, callback: () => void) => new Promise<void>((resolve) => {
      release.push(() => { callback(); resolve(); });
    }));
    vi.stubGlobal("navigator", { locks: { request } });
    consent.writeCookieConsent(true, true); enter(step); const calls = sdkReady(); await flush();
    // Native History/usePathname updates or Strict Mode can rerun the effect
    // while Chrome is asynchronously acquiring the Web Lock.
    tracker.updateMetaQuizStage(null); enter(step); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingle")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    release.shift()!(); await flush();
    const names = ["LandingView", "ContactCompleted", "QuizCompleted", "TaskSubmitted"];
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toEqual([
      ["trackSingleCustom", "1823278402432437", names[step], { step: step + 1 }],
    ]);
    expect(browser.localStorage.length).toBe(1);
    enter(step); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toHaveLength(1);
  });

  it.each(["withdrawal", "unmount", "different stage", "different visitor"])("drops a waiting conversion after %s", async (change) => {
    const release: (() => void)[] = [];
    const request = vi.fn((_name: string, callback: () => void) => new Promise<void>((resolve) => {
      release.push(() => { callback(); resolve(); });
    }));
    vi.stubGlobal("navigator", { locks: { request } });
    consent.writeCookieConsent(true, true); enter(2); const calls = sdkReady(); await flush();
    if (change === "withdrawal") consent.writeCookieConsent(true, false);
    if (change === "unmount") tracker.updateMetaQuizStage(null);
    if (change === "different stage") enter(3);
    if (change === "different visitor") enter(2, marketingScope("visitor-b"));
    await flush(); release.shift()!(); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toHaveLength(0);
    expect(browser.localStorage.length).toBe(0);
    // Finish a later valid request independently of the stale one.
    if (release.length) { release.shift()!(); await flush(); }
  });

  it("still sends once when the browser exposes Web Locks but denies access", async () => {
    const request = vi.fn().mockRejectedValue(new Error("Web Locks unavailable"));
    vi.stubGlobal("navigator", { locks: { request } });
    consent.writeCookieConsent(true, true); enter(3); const calls = sdkReady(); await flush();
    expect(calls).toHaveBeenCalledWith("trackSingleCustom", "1823278402432437", "TaskSubmitted", { step: 4 });
    expect(browser.localStorage.length).toBe(1);
    enter(3); await flush();
    expect(calls.mock.calls.filter(([m]) => m === "trackSingleCustom")).toHaveLength(1);
  });

  it("never runs on admin, preview/local, unknown-query, hash or private referrer URLs", () => {
    for (const url of ["https://alleybiz.vercel.app/admin", "http://localhost:3008/", "https://preview.vercel.app/", "https://alleybiz.vercel.app/?email=private", "https://alleybiz.vercel.app/#token", "https://alleybiz.vercel.app:444/"]) {
      expect(tracker.isMetaQuizLocation(url)).toBe(false);
    }
    expect(tracker.isMetaQuizLocation("https://alleybiz.vercel.app/", "https://alleybiz.vercel.app/admin/leads/12")).toBe(false);
    expect(tracker.isMetaQuizLocation("https://alleybiz.vercel.app/", "https://example.org/?token=private")).toBe(false);
    expect(tracker.isMetaQuizLocation("https://alleybiz.vercel.app/", "https://example.org/admin/private-token")).toBe(false);
    expect(tracker.isMetaQuizLocation("https://alleybiz.vercel.app/step-3-task?utm_source=facebook&fbclid=click", "https://itsolution.fun/")).toBe(true);
  });

  it("uses an opaque non-authorizing local scope instead of the visitor session ID", () => {
    expect(scope).toMatch(/^[a-f0-9]{64}$/);
    expect(scope).not.toContain("visitor-a");
    expect(scope).toBe(marketingScope("visitor-a"));
    expect(scope).not.toBe(marketingScope("visitor-b"));
  });
});
