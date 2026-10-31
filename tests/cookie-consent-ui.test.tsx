// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CookieConsent } from "@/components/privacy/CookieConsent";
import { COOKIE_CONSENT_NAME, COOKIE_SETTINGS_EVENT, readCookieConsent, writeCookieConsent } from "@/lib/cookie-consent";

const path = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/attribution-consent-sync", () => ({ observeAttributionConsent: () => () => {} }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  path.current = "/";
  document.cookie = `${COOKIE_CONSENT_NAME}=; Path=/; Max-Age=0`;
  window.localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.cookie = `${COOKIE_CONSENT_NAME}=; Path=/; Max-Age=0`;
  vi.unstubAllGlobals();
});
const button = (scope: Element, text: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
const banner = () => host.querySelector('section[aria-label="PLIKI COOKIE"]');
const mount = () => act(async () => root.render(<CookieConsent />));
const openSettings = () => act(async () => { window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT)); });

describe("separate marketing cookie choice", () => {
  it("asks legacy visitors again, keeps their preferences and does not preselect Meta", async () => {
    document.cookie = `${COOKIE_CONSENT_NAME}=${encodeURIComponent(JSON.stringify({ version: 2, necessary: true, preferences: true, updatedAt: Date.now() }))}; Path=/`;
    await mount();
    expect(banner()).not.toBeNull();
    expect(readCookieConsent()).toMatchObject({ preferences: true, marketing: false });
    await openSettings();
    expect(host.querySelector<HTMLInputElement>("#cookie-preferences")!.checked).toBe(true);
    expect(host.querySelector<HTMLInputElement>("#cookie-marketing")!.checked).toBe(false);
  });

  it("grants both purposes only through Accept all, and withdraws both through Necessary only", async () => {
    await mount();
    await act(async () => button(banner()!, "Akceptuj wszystkie").click());
    expect(readCookieConsent()).toMatchObject({ version: 3, preferences: true, marketing: true });
    expect(banner()).toBeNull();
    await openSettings();
    await act(async () => button(host.querySelector("dialog")!, "Tylko niezbędne").click());
    expect(readCookieConsent()).toMatchObject({ preferences: false, marketing: false });
  });

  it("can grant or withdraw marketing without changing the internal analytics choice", async () => {
    writeCookieConsent(true, false);
    await mount();
    expect(banner()).toBeNull();
    await openSettings();
    await act(async () => host.querySelector<HTMLInputElement>("#cookie-marketing")!.click());
    await act(async () => button(host.querySelector("dialog")!, "Zapisz mój wybór").click());
    expect(readCookieConsent()).toMatchObject({ preferences: true, marketing: true });
    await openSettings();
    await act(async () => host.querySelector<HTMLInputElement>("#cookie-marketing")!.click());
    await act(async () => button(host.querySelector("dialog")!, "Zapisz mój wybór").click());
    expect(readCookieConsent()).toMatchObject({ preferences: true, marketing: false });
  });

  it("does not render visitor tracking choices in the administrator panel", async () => {
    path.current = "/admin/leads/1";
    await mount();
    expect(host.innerHTML).toBe("");
  });

  it("clears Meta storage from the policy page without requiring the quiz tracker to be mounted", async () => {
    path.current = "/cookie-policy";
    writeCookieConsent(true, true);
    document.cookie = "_fbp=test-browser; Path=/";
    document.cookie = "_fbc=test-click; Path=/";
    window.localStorage.setItem("ab_meta_events:test", "event-marker");
    window.localStorage.setItem("nl-sound-visitor", "off");
    await mount();
    await openSettings();
    await act(async () => host.querySelector<HTMLInputElement>("#cookie-marketing")!.click());
    await act(async () => button(host.querySelector("dialog")!, "Zapisz mój wybór").click());
    expect(document.cookie).not.toMatch(/_fbp=|_fbc=/);
    expect(window.localStorage.getItem("ab_meta_events:test")).toBeNull();
    expect(window.localStorage.getItem("nl-sound-visitor")).toBe("off");
    expect(readCookieConsent()).toMatchObject({ preferences: true, marketing: false });
  });
});
