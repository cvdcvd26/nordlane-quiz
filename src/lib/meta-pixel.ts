import { metaPixelConfig } from "@/config/meta-pixel";
import { COOKIE_CONSENT_EVENT, readCookieConsent } from "@/lib/cookie-consent";
import { clearMetaMarketingStorage, hasMetaStageMarker, saveMetaStageMarker } from "@/lib/meta-pixel-storage";
import { latestQuizStep, QUIZ_STEP_PATHS, type QuizProgress, type QuizStep } from "@/lib/quiz-steps";

type Pixel = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push?: Pixel;
  loaded?: boolean;
  version?: string;
  disablePushState?: boolean;
};
type PixelWindow = Window & { fbq?: Pixel; _fbq?: Pixel };
export type MetaQuizStage = { scope: string; step: QuizStep; progress: QuizProgress };
const QUERY_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"]);
const SCRIPT_ID = "alleybiz-meta-pixel";
let scriptPromise: Promise<void> | null = null;
let initialized = false;
let observing = false;
let current: MetaQuizStage | null = null;
let permitted = false;
const handedOff = new Set<string>();
const pageViews = new Set<string>();
const pending = new Set<string>();

/** Restrict SDK access to public quiz URLs; it reads the document URL/referrer itself. */
export function isMetaQuizLocation(href: string, referrer = "") {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || !metaPixelConfig.hosts.some((host) => host === url.hostname) || url.port ||
        url.username || url.password || url.hash || !QUIZ_STEP_PATHS.some((path) => path === url.pathname)) return false;
    if ([...url.searchParams.keys()].some((key) => !QUERY_KEYS.has(key))) return false;
    if (referrer) {
      const from = new URL(referrer);
      if (from.username || from.password || from.hash || [...from.searchParams.keys()].some((key) => !QUERY_KEYS.has(key))) return false;
      if (from.origin === url.origin && !QUIZ_STEP_PATHS.some((path) => path === from.pathname) && from.pathname !== "/cookie-policy") return false;
      if (from.origin !== url.origin && from.pathname !== "/" && !(from.hostname === "itsolution.fun" && from.pathname === "/index.html")) return false;
    }
    return true;
  } catch { return false; }
}

function canTrack(stage: MetaQuizStage | null): stage is MetaQuizStage {
  return Boolean(stage && /^[a-f0-9]{64}$/.test(stage.scope) &&
    readCookieConsent()?.marketing === true && stage.step <= latestQuizStep(stage.progress) &&
    window.location.pathname === QUIZ_STEP_PATHS[stage.step] && isMetaQuizLocation(window.location.href, document.referrer));
}

function pixel() { return (window as PixelWindow).fbq; }

function loadPixel(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  const w = window as PixelWindow;
  if (!w.fbq) {
    const fbq: Pixel = Object.assign((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    }, { queue: [] as unknown[][], loaded: true, version: "2.0", disablePushState: true });
    fbq.push = fbq;
    w.fbq = fbq;
    w._fbq = fbq;
  }
  w.fbq.disablePushState = true;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    script.referrerPolicy = "origin";
    script.onload = () => {
      if (pixel()?.callMethod) resolve();
      else { script.remove(); scriptPromise = null; reject(new Error("Meta Pixel unavailable")); }
    };
    script.onerror = () => { script.remove(); scriptPromise = null; reject(new Error("Meta Pixel blocked")); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function revoke() {
  if (pixel()) pixel()!("consent", "revoke");
  permitted = false;
  if (readCookieConsent()?.marketing !== true) clearMetaMarketingStorage();
}

async function refresh() {
  const stage = current;
  if (!canTrack(stage)) { revoke(); return; }
  try {
    await loadPixel();
    // Consent, route, and session can change while the SDK is downloading.
    if (current !== stage || !canTrack(stage)) return;
    const fbq = pixel()!;
    if (!initialized) {
      fbq("consent", "revoke");
      fbq("set", "autoConfig", false, metaPixelConfig.id);
      fbq("optOut", metaPixelConfig.id, "AutomaticMatching");
      fbq("init", metaPixelConfig.id);
      initialized = true;
    }
    if (!permitted) { fbq("consent", "grant"); permitted = true; }
    const path = QUIZ_STEP_PATHS[stage.step];
    if (!pageViews.has(path)) {
      fbq("trackSingle", metaPixelConfig.id, "PageView");
      pageViews.add(path);
    }
    const key = `${stage.scope}:${stage.step}`;
    if (pending.has(key) || handedOff.has(key)) return;
    pending.add(key);
    const send = () => {
      const live = current;
      // React can replace the stage object while this Web Lock is waiting.
      // Keep the same visitor/stage eligible, but recheck its latest state.
      if (!canTrack(live) || live.scope !== stage.scope || live.step !== stage.step ||
          handedOff.has(key) || hasMetaStageMarker(live.scope, live.step)) return;
      // No session identifiers, contacts, answers, files, or chat text go to Meta.
      fbq("trackSingleCustom", metaPixelConfig.id, metaPixelConfig.events[live.step], { step: live.step + 1 });
      handedOff.add(key);
      saveMetaStageMarker(live.scope, live.step);
    };
    try {
      // Serialize two tabs belonging to the same visitor, where Web Locks is available.
      if (navigator.locks?.request) {
        try { await navigator.locks.request(`ab-meta:${key}`, send); }
        catch { send(); } // Some browsers expose this optional API but deny access.
      } else send();
    } finally { pending.delete(key); }
  } catch { /* Ad blockers/network failure must never interrupt the application. */ }
}

export function updateMetaQuizStage(stage: MetaQuizStage | null) {
  current = stage;
  if (!observing) {
    observing = true;
    // Kept after quiz unmount so a withdrawal on the policy page revokes the SDK too.
    window.addEventListener(COOKIE_CONSENT_EVENT, () => { void refresh(); });
    window.addEventListener("focus", () => { void refresh(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refresh(); });
  }
  void refresh();
}
