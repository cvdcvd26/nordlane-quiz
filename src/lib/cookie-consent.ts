export const COOKIE_CONSENT_NAME = "ab_cookie_consent";
export const COOKIE_CONSENT_EVENT = "alleybiz:cookie-consent";
export const COOKIE_SETTINGS_EVENT = "alleybiz:cookie-settings";
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
export const VISITOR_SOUND_KEY = "nl-sound-visitor";

export type CookieConsent = {
  version: 1;
  necessary: true;
  preferences: boolean;
  updatedAt: number;
};

/** A missing, old, damaged or expired decision never enables optional storage. */
export function parseCookieConsent(raw: string | undefined, now = Date.now()): CookieConsent | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw));
    if (!value || typeof value !== "object") return null;
    const item = value as Partial<CookieConsent>;
    if (item.version !== 1 || item.necessary !== true || typeof item.preferences !== "boolean" ||
        typeof item.updatedAt !== "number" || !Number.isSafeInteger(item.updatedAt) || item.updatedAt <= 0 ||
        item.updatedAt > now + 60_000 || now - item.updatedAt >= COOKIE_CONSENT_MAX_AGE_SECONDS * 1000) return null;
    return { version: 1, necessary: true, preferences: item.preferences, updatedAt: item.updatedAt };
  } catch {
    return null;
  }
}

function rawCookie() {
  return document.cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_CONSENT_NAME}=`))?.slice(COOKIE_CONSENT_NAME.length + 1);
}

// Stable snapshots for useSyncExternalStore; this cache is used only in the browser.
let lastRaw: string | undefined;
let lastConsent: CookieConsent | null = null;

export function readCookieConsent(): CookieConsent | null {
  if (typeof document === "undefined") return null;
  try {
    const raw = rawCookie();
    if (raw !== lastRaw || (lastConsent && Date.now() - lastConsent.updatedAt >= COOKIE_CONSENT_MAX_AGE_SECONDS * 1000)) {
      lastRaw = raw;
      lastConsent = parseCookieConsent(raw);
    }
    return lastConsent;
  } catch {
    return null;
  }
}

export function clearVisitorSoundPreference() {
  try { window.localStorage.removeItem(VISITOR_SOUND_KEY); } catch { /* Storage may be disabled. */ }
}

/** Persists just the decision, with no visitor ID, contact details or tracking data. */
export function writeCookieConsent(preferences: boolean): CookieConsent {
  const decision: CookieConsent = { version: 1, necessary: true, preferences, updatedAt: Date.now() };
  const encoded = encodeURIComponent(JSON.stringify(decision));
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_CONSENT_NAME}=${encoded}; Path=/; Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  if (rawCookie() !== encoded) throw new Error("Nie udało się zapisać wyboru. Sprawdź ustawienia plików cookie w przeglądarce.");
  lastRaw = encoded;
  lastConsent = decision;
  if (!preferences) clearVisitorSoundPreference();
  window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
  return decision;
}

export function openCookieSettings() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT));
}
