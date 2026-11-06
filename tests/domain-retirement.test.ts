import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { domainMigrationEnabled, legacySiteHosts, siteDomains } from "@/config/site-domains";

const maintenance = vi.hoisted(() => vi.fn());
vi.mock("@/server/maintenance", () => ({ isMaintenanceEnabled: maintenance }));

beforeEach(() => {
  vi.stubEnv("APP_URL", siteDomains.canonical);
  vi.stubEnv("LEGACY_SITE_RETIRED", "true");
  // A leftover migration setting must never undo the explicit retirement.
  vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "true");
  maintenance.mockReset(); maintenance.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

const paths = [
  "/", "/step-2", "/step-3-task", "/step-4-confirmation", "/cookie-policy",
  "/admin", "/admin/login", "/api/admin/login", "/api/session", "/api/chat",
  "/api/files/test", "/api/jobs/sweep", "/api/jobs/deliver",
  "/api/jobs/queue-deliver", "/api/jobs/candidate-email-deliver", "/api/jobs/candidate-email-queue",
  "/session-transfer/start", "/session-transfer/authorize", "/api/session-transfer/complete",
  "/_next/static/chunks/app.js", "/_next/image?url=%2Fmaja-hr.png&w=64&q=75",
  "/favicon.ico", "/it-solution-mark.svg", "/Rejestracja_Ryanair_Instrukcja.pdf",
];

it.each(legacySiteHosts)("closes every route and asset on %s without redirect, cookies or application access", async host => {
  for (const path of paths) {
    const url = `https://${host}${path}`;
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    for (const method of ["GET", "POST"]) {
      const response = await proxy(new NextRequest(url, {
        method, headers: { cookie: "nl_admin=old; nl_visitor=old; nl_domain_checked=1" },
      }));
      expect(response.status).toBe(410);
      expect(getRedirectUrl(response)).toBeNull();
      expect(response.headers.has("x-middleware-next")).toBe(false);
      expect(response.headers.has("x-middleware-rewrite")).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await response.text()).toBe("Ta strona została zamknięta.");
    }
  }
  expect(maintenance).not.toHaveBeenCalled();
});

it("opens the new site directly on a first visit and disables every automatic recovery redirect", async () => {
  expect(domainMigrationEnabled()).toBe(false);
  for (const path of ["/", "/step-2", "/step-3-task", "/step-4-confirmation", "/cookie-policy", "/admin/login"]) {
    const response = await proxy(new NextRequest(`${siteDomains.canonical}${path}`));
    expect(response.status).toBe(200);
    expect(getRedirectUrl(response)).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("set-cookie")).toBe(false);
  }
});

it("preserves normal new-host API and static handling without widening the matcher for other hosts", async () => {
  for (const origin of [siteDomains.canonical, "https://arbitrary-preview.vercel.app"]) {
    for (const path of ["/api/session", "/api/jobs/candidate-email-queue", "/_next/static/app.js", "/it-solution-mark.svg"]) {
      const url = `${origin}${path}`;
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
      expect((await proxy(new NextRequest(url))).status).toBe(200);
    }
  }
  expect(maintenance).not.toHaveBeenCalled();
});

it("closes old hosts even if APP_URL is stale, without affecting a similar hostname", async () => {
  vi.stubEnv("APP_URL", siteDomains.legacy);
  expect((await proxy(new NextRequest("http://alleybiz.vercel.app/admin/login"))).status).toBe(410);
  expect((await proxy(new NextRequest("https://alleybiz.vercel.app.evil.test/"))).status).toBe(200);
});

it("does not retire hosts before the explicit rollout flag is enabled", async () => {
  vi.stubEnv("LEGACY_SITE_RETIRED", "false");
  vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "false");
  for (const host of legacySiteHosts) {
    const response = await proxy(new NextRequest(`https://${host}/admin/login`));
    expect(response.status).toBe(200);
    expect(getRedirectUrl(response)).toBeNull();
  }
});
