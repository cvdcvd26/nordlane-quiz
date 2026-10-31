import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_CONSENT_MAX_AGE_SECONDS, COOKIE_CONSENT_NAME, COOKIE_CONSENT_EVENT,
  parseCookieConsent, readCookieConsent, writeCookieConsent,
} from "@/lib/cookie-consent";
import { isSoundEnabled, setSoundEnabled } from "@/lib/sound";
import { clearMetaMarketingStorage } from "@/lib/meta-pixel-storage";

vi.mock("@/lib/meta-pixel-storage", () => ({ clearMetaMarketingStorage: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function browser() {
  let raw = "";
  let written = "";
  const values = new Map<string, string>();
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  const document = { get cookie() { return raw; }, set cookie(value: string) { written = value; raw = value.split(";")[0]; } };
  const dispatchEvent = vi.fn();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { location: { protocol: "https:" }, localStorage, dispatchEvent });
  return { values, localStorage, dispatchEvent, written: () => written, raw: (value: string) => { raw = value; } };
}

describe("cookie choices and optional sound preferences", () => {
  it("does not treat malformed, obsolete or expired records as consent", () => {
    const now = 1_800_000_000_000;
    const encode = (changes: object) => encodeURIComponent(JSON.stringify({ version: 2, necessary: true, preferences: true, updatedAt: now, ...changes }));
    expect(parseCookieConsent(undefined, now)).toBeNull();
    expect(parseCookieConsent("%zz", now)).toBeNull();
    for (const changes of [{version: 1}, {version: 4}, {version: 3}, {version: 3, marketing: "yes"}, {necessary: false}, {preferences: "yes"}, {updatedAt: now + 120_000}, {updatedAt: now - COOKIE_CONSENT_MAX_AGE_SECONDS * 1000}])
      expect(parseCookieConsent(encode(changes), now)).toBeNull();
    expect(parseCookieConsent(encode({preferences: false}), now)?.preferences).toBe(false);
  });

  it("preserves legacy preferences without treating old all-cookies consent as a marketing grant", () => {
    const now = Date.now();
    for (const preferences of [true, false]) {
      const raw = encodeURIComponent(JSON.stringify({ version: 2, necessary: true, preferences, marketing: true, updatedAt: now }));
      expect(parseCookieConsent(raw, now)).toEqual({ version: 2, necessary: true, preferences, marketing: false, updatedAt: now });
    }
  });

  it("keeps marketing and internal preferences independent and defaults older callers to no marketing", () => {
    browser();
    expect(writeCookieConsent(true)).toMatchObject({ version: 3, preferences: true, marketing: false });
    expect(writeCookieConsent(false, true)).toMatchObject({ version: 3, preferences: false, marketing: true });
    expect(readCookieConsent()).toMatchObject({ version: 3, preferences: false, marketing: true });
    expect(writeCookieConsent(true, false)).toMatchObject({ version: 3, preferences: true, marketing: false });
    expect(readCookieConsent()).toMatchObject({ preferences: true, marketing: false });
  });

  it("clears Meta storage only after a successful denial or withdrawal write", () => {
    browser();
    writeCookieConsent(true, true);
    expect(clearMetaMarketingStorage).not.toHaveBeenCalled();
    writeCookieConsent(true, false);
    expect(clearMetaMarketingStorage).toHaveBeenCalledTimes(1);
    vi.stubGlobal("document", { get cookie() { return ""; }, set cookie(_value: string) {} });
    expect(() => writeCookieConsent(false, false)).toThrow();
    expect(clearMetaMarketingStorage).toHaveBeenCalledTimes(1);
  });

  it("stores a secure 180-day decision and provides stable UI snapshots", () => {
    const b = browser();
    const saved = writeCookieConsent(true);
    expect(b.written()).toContain(`${COOKIE_CONSENT_NAME}=`);
    expect(b.written()).toContain(`Max-Age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax; Secure`);
    expect(readCookieConsent()).toBe(saved);
    expect(readCookieConsent()).toBe(readCookieConsent());
    expect(b.dispatchEvent.mock.calls[0][0].type).toBe(COOKIE_CONSENT_EVENT);
  });

  it("does not read or persist optional sound choices before consent", () => {
    const b = browser();
    b.values.set("nl-sound-visitor", "off");
    expect(isSoundEnabled("visitor")).toBe(true);
    setSoundEnabled("visitor", false);
    expect(b.localStorage.getItem).not.toHaveBeenCalled();
    expect(b.localStorage.setItem).not.toHaveBeenCalled();
    expect(b.values.has("nl-sound-visitor")).toBe(false);
  });

  it("remembers optional sound only while consent is active and removes it on withdrawal", () => {
    const b = browser();
    writeCookieConsent(true);
    setSoundEnabled("visitor", false);
    expect(b.values.get("nl-sound-visitor")).toBe("off");
    expect(isSoundEnabled("visitor")).toBe(false);
    writeCookieConsent(false);
    expect(b.values.has("nl-sound-visitor")).toBe(false);
    expect(isSoundEnabled("visitor")).toBe(true);
    setSoundEnabled("visitor", false);
    expect(b.values.has("nl-sound-visitor")).toBe(false);
  });

  it("keeps admin preferences separate and rejects a failed cookie write", () => {
    const b = browser();
    setSoundEnabled("admin", false);
    expect(isSoundEnabled("admin")).toBe(false);
    vi.stubGlobal("document", { get cookie() { return ""; }, set cookie(_value: string) {} });
    expect(() => writeCookieConsent(true)).toThrow("Nie udało się zapisać wyboru");
    b.raw("");
  });
});
