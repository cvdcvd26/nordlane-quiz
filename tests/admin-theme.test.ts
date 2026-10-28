import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/components/admin/BrandMark", () => ({ BrandMark: () => null }));

const KEY = "nl-admin-theme";

function installBrowser(saved: string | null = null) {
  const values = new Map<string, string>(saved === null ? [] : [[KEY, saved]]);
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  const events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  const storageChange = (newValue: string | null, key: string | null = KEY, storageArea: unknown = localStorage) => {
    const event = new Event("storage");
    Object.defineProperties(event, { key: { value: key }, newValue: { value: newValue }, storageArea: { value: storageArea } });
    events.dispatchEvent(event);
  };
  return { values, localStorage, storageChange };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("admin theme preference", () => {
  it("defaults to dark and preserves a saved light choice across a new page store", async () => {
    const browser = installBrowser();
    let store = await import("@/config/admin-theme");
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    const changed = vi.fn();
    const unsubscribe = store.subscribeAdminTheme(changed);
    store.setAdminTheme("light");
    expect(changed).toHaveBeenCalledOnce();
    expect(store.getAdminThemeSnapshot()).toBe("light");
    expect(browser.values.get(KEY)).toBe("light");
    unsubscribe();

    vi.resetModules();
    store = await import("@/config/admin-theme");
    expect(store.getAdminThemeSnapshot()).toBe("light");
    expect(store.getServerAdminThemeSnapshot()).toBe("dark");
  });

  it.each(["dark", "system", "DARK", "", "<script>"])("safely resolves stored %j to dark", async (value) => {
    installBrowser(value);
    const store = await import("@/config/admin-theme");
    expect(store.getAdminThemeSnapshot()).toBe("dark");
  });

  it("retains a working page choice when reads and writes are blocked", async () => {
    const browser = installBrowser();
    browser.localStorage.getItem.mockImplementation(() => { throw new Error("blocked"); });
    browser.localStorage.setItem.mockImplementation(() => { throw new Error("blocked"); });
    const store = await import("@/config/admin-theme");
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    const unsubscribe = store.subscribeAdminTheme(vi.fn());
    expect(() => store.setAdminTheme("light")).not.toThrow();
    expect(store.getAdminThemeSnapshot()).toBe("light");
    unsubscribe();
    const resubscribe = store.subscribeAdminTheme(vi.fn());
    expect(store.getAdminThemeSnapshot()).toBe("light");
    store.setAdminTheme("dark");
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    resubscribe();
  });

  it("also handles browsers that deny access to the storage property itself", async () => {
    const events = new EventTarget();
    vi.stubGlobal("window", {
      get localStorage() { throw new Error("denied"); },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    });
    const store = await import("@/config/admin-theme");
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    store.setAdminTheme("light");
    expect(store.getAdminThemeSnapshot()).toBe("light");
  });

  it("syncs other tabs, resets removed or invalid preferences, and ignores unrelated storage", async () => {
    const browser = installBrowser();
    const store = await import("@/config/admin-theme");
    const changed = vi.fn();
    const unsubscribe = store.subscribeAdminTheme(changed);
    browser.storageChange("light", "visitor-theme");
    browser.storageChange("light", KEY, {});
    expect(changed).not.toHaveBeenCalled();
    browser.storageChange("light");
    expect(store.getAdminThemeSnapshot()).toBe("light");
    browser.storageChange("invalid");
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    browser.storageChange("light");
    browser.storageChange(null);
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    browser.storageChange("light");
    browser.storageChange(null, null);
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    expect(changed).toHaveBeenCalledTimes(6);
    expect(browser.localStorage.setItem).not.toHaveBeenCalled();
    unsubscribe();
    browser.storageChange("light");
    expect(changed).toHaveBeenCalledTimes(6);
  });

  it("refreshes from storage when a shell subscribes again after another tab changes it", async () => {
    const browser = installBrowser("light");
    const store = await import("@/config/admin-theme");
    const unsubscribe = store.subscribeAdminTheme(vi.fn());
    expect(store.getAdminThemeSnapshot()).toBe("light");
    unsubscribe();
    browser.values.set(KEY, "dark");
    const unsubscribeAgain = store.subscribeAdminTheme(vi.fn());
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    unsubscribeAgain();
  });

  it("does not read browser storage during import or server rendering, even with saved light", async () => {
    const browser = installBrowser("light");
    const store = await import("@/config/admin-theme");
    expect(browser.localStorage.getItem).not.toHaveBeenCalled();
    const { AdminShell } = await import("@/components/admin/AdminShell");
    const markup = renderToStaticMarkup(createElement(AdminShell, null, "admin content"));
    expect(markup).toContain('data-admin-theme="dark"');
    expect(markup.match(/data-admin-theme=/g)).toHaveLength(1);
    expect(markup).toContain('role="switch" aria-checked="true"');
    expect(browser.localStorage.getItem).not.toHaveBeenCalled();
    expect(store.getAdminThemeSnapshot()).toBe("light");
    expect(store.getServerAdminThemeSnapshot()).toBe("dark");
  });

  it("works without a browser and never applies a preference to the visitor document", async () => {
    vi.stubGlobal("window", undefined);
    const store = await import("@/config/admin-theme");
    expect(store.getAdminThemeSnapshot()).toBe("dark");
    expect(() => store.setAdminTheme("light")).not.toThrow();
    expect(store.getServerAdminThemeSnapshot()).toBe("dark");

    installBrowser();
    const root = { setAttribute: vi.fn(), style: { setProperty: vi.fn() }, classList: { add: vi.fn(), remove: vi.fn() } };
    vi.stubGlobal("document", { documentElement: root });
    store.setAdminTheme("light");
    expect(root.setAttribute).not.toHaveBeenCalled();
    expect(root.style.setProperty).not.toHaveBeenCalled();
    expect(root.classList.add).not.toHaveBeenCalled();
    expect(root.classList.remove).not.toHaveBeenCalled();
  });
});

function luminance(hex: string) {
  const rgb = hex.match(/[\da-f]{2}/gi)!.map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

describe("admin dark palette readability", () => {
  it("keeps text, status colors, and primary button labels at AA contrast", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const palette = css.match(/\.adm:not\(\[data-admin-theme="light"\]\)\s*\{([^}]+)\}/)![1];
    const colors = Object.fromEntries([...palette.matchAll(/--color-adm-([\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]));
    const contrast = (a: string, b: string) => {
      const values = [luminance(colors[a]), luminance(colors[b])].sort((x, y) => y - x);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    for (const foreground of ["ink", "ink-2", "ink-3", "accent"]) {
      for (const background of ["bg", "surface", "subtle"]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const status of ["blue", "amber", "violet", "green", "red"]) {
      expect(contrast(status, `${status}-bg`)).toBeGreaterThanOrEqual(4.5);
      expect(contrast("bg", status)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("on-accent", "accent")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("on-danger", "red")).toBeGreaterThanOrEqual(4.5);
  });
});
