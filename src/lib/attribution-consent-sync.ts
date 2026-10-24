"use client";
import { api, ApiError } from "./api";
import { COOKIE_CONSENT_EVENT, COOKIE_CONSENT_NAME, readCookieConsent, type CookieConsent } from "./cookie-consent";
import { collectVisitorAttribution, type VisitorAttributionInput } from "./visitor-attribution";

type Payload = VisitorAttributionInput | Record<string, never>;
type Environment = {
  readConsent: () => CookieConsent | null;
  hasConsentCookie: () => boolean;
  collect: () => VisitorAttributionInput;
  send: (payload: Payload) => Promise<unknown>;
  isVisible: () => boolean;
  windowEvents: EventTarget;
  documentEvents: EventTarget;
};

const RETRY_MS = 30_000;
const MIN_RETRY_MS = 5_000;
const decisionKey = (consent: CookieConsent | null) => consent ? `${consent.version}:${consent.preferences}:${consent.updatedAt}` : "unset";

/** One serialized sender for every visitor cookie-settings surface, with no session creation. */
export function createAttributionConsentSync(environment: Environment) {
  let observers = 0;
  let acknowledged: string | null = null;
  let lastAttemptKey: string | null = null;
  let lastAttemptAt = 0;
  let requested = false;
  let retryNow = false;
  let worker: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearRetry = () => { clearTimeout(timer); timer = undefined; };
  const scheduleRetry = () => {
    if (!observers || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (environment.isVisible()) void sync();
    }, RETRY_MS);
  };
  const shouldRetry = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status === 429 || error.status >= 500;

  function sync(immediateRetry = false): Promise<void> {
    requested = true;
    retryNow ||= immediateRetry;
    if (worker) return worker;
    // Start in a microtask so concurrent mount/session-ready/visibility signals coalesce.
    worker = Promise.resolve().then(async () => {
      while (requested) {
        requested = false;
        const immediate = retryNow;
        retryNow = false;
        const consent = environment.readConsent();
        const key = decisionKey(consent);
        if (key === acknowledged) continue;
        if (consent?.preferences && !environment.isVisible()) continue;
        if (!immediate && key === lastAttemptKey && Date.now() - lastAttemptAt < MIN_RETRY_MS) {
          scheduleRetry();
          continue;
        }
        lastAttemptAt = Date.now();
        lastAttemptKey = key;
        try {
          // Retries read the latest choice and URLs here; an old grant is never kept as queued payload.
          const payload = consent?.preferences ? environment.collect() : {};
          await environment.send(payload);
          acknowledged = key;
          clearRetry();
        } catch (error) {
          if (shouldRetry(error)) scheduleRetry(); else clearRetry();
          // 401 waits for session-ready / a later visible return. This endpoint never creates a session.
        }
        if (decisionKey(environment.readConsent()) !== key) {
          requested = true;
          retryNow = true;
        }
      }
    }).finally(() => {
      worker = null;
      if (requested) void sync();
    });
    return worker;
  }

  const onConsent = () => { void sync(true); };
  const onReturn = () => {
    if (environment.isVisible() && (environment.hasConsentCookie() || lastAttemptKey !== null)) void sync();
  };

  return {
    sync,
    /** /api/session may have just replaced an expired or missing httpOnly session cookie. */
    sessionReady() {
      if (!worker) acknowledged = null;
      return sync(true);
    },
    observe() {
      observers += 1;
      if (observers === 1) {
        environment.windowEvents.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
        environment.windowEvents.addEventListener("focus", onReturn);
        environment.windowEvents.addEventListener("pageshow", onReturn);
        environment.documentEvents.addEventListener("visibilitychange", onReturn);
        if (environment.hasConsentCookie()) void sync();
      }
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        observers -= 1;
        if (observers !== 0) return;
        clearRetry();
        environment.windowEvents.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
        environment.windowEvents.removeEventListener("focus", onReturn);
        environment.windowEvents.removeEventListener("pageshow", onReturn);
        environment.documentEvents.removeEventListener("visibilitychange", onReturn);
      };
    },
  };
}

let browserSync: ReturnType<typeof createAttributionConsentSync> | undefined;
function getBrowserSync() {
  return browserSync ??= createAttributionConsentSync({
    readConsent: readCookieConsent,
    hasConsentCookie: () => {
      try { return document.cookie.split(";").some(part => part.trim().startsWith(`${COOKIE_CONSENT_NAME}=`)); }
      catch { return false; }
    },
    collect: () => collectVisitorAttribution(window.location.href, document.referrer),
    send: json => api("/api/visitor/attribution", { method: "POST", credentials: "same-origin", json }),
    isVisible: () => document.visibilityState === "visible",
    windowEvents: window,
    documentEvents: document,
  });
}

export const observeAttributionConsent = () => getBrowserSync().observe();
export const syncAttributionAfterSessionReady = () => getBrowserSync().sessionReady();
export const retryAttributionConsent = () => browserSync?.sync();
