import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";
import { migrationDestination, siteDomains } from "@/config/site-domains";
import { collectVisitorAttribution } from "@/lib/visitor-attribution";

const enabled = vi.hoisted(() => vi.fn());
vi.mock("@/server/maintenance", () => ({ isMaintenanceEnabled: enabled }));
beforeEach(() => {
  vi.stubEnv("LEGACY_SITE_RETIRED", "false");
  vi.stubEnv("APP_URL", siteDomains.canonical); vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "true");
  enabled.mockReset(); enabled.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

it("sends old frontend visitors through fixed-origin recovery without rendering the old site", async () => {
  const response = await proxy(new NextRequest(`${siteDomains.legacy}/step-3-task?utm_campaign=jobs&email=private`));
  const target = new URL(getRedirectUrl(response)!);
  expect(target.origin).toBe(siteDomains.canonical);
  expect(target.pathname).toBe("/session-transfer/start");
  expect(target.searchParams.get("path")).toBe("/step-3-task?utm_campaign=jobs");
  expect(response.status).toBe(303);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(enabled).not.toHaveBeenCalled();
});

it("checks old credentials on a new-domain first visit only, without creating a redirect loop", async () => {
  expect(getRedirectUrl(await proxy(new NextRequest(`${siteDomains.canonical}/`)))).toBe(`${siteDomains.canonical}/session-transfer/start?path=%2F`);
  expect(getRedirectUrl(await proxy(new NextRequest(`${siteDomains.canonical}/`, { headers: { cookie: "nl_domain_checked=1" } })))).toBeNull();
  for (const origin of [siteDomains.canonical, siteDomains.legacy]) {
    for (const path of ["/session-transfer/start", "/session-transfer/authorize", "/session-transfer/complete", "/session-transfer/skip"]) {
      expect(getRedirectUrl(await proxy(new NextRequest(`${origin}${path}`)))).toBeNull();
    }
  }
});

it("does not transfer administrator access and keeps old file/queue APIs reachable", async () => {
  const response = await proxy(new NextRequest(`${siteDomains.legacy}/admin/leads/4`, { headers: { cookie: "nl_admin=secret" } }));
  expect(getRedirectUrl(response)).toBe(`${siteDomains.canonical}/admin/login`);
  for (const path of ["/api/files/test", "/api/jobs/deliver", "/api/jobs/candidate-email", "/api/session-transfer/complete", "/_next/static/app.js", "/it-solution-mark.svg"]) {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `${siteDomains.legacy}${path}` })).toBe(true);
    expect(getRedirectUrl(await proxy(new NextRequest(`${siteDomains.legacy}${path}`)))).toBeNull();
  }
});

it("stays disabled until both explicit activation and the exact canonical URL are configured", async () => {
  vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "false");
  expect(getRedirectUrl(await proxy(new NextRequest(siteDomains.legacy)))).toBeNull();
  vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "true"); vi.stubEnv("APP_URL", siteDomains.legacy);
  expect(getRedirectUrl(await proxy(new NextRequest(siteDomains.legacy)))).toBeNull();
  vi.stubEnv("APP_URL", siteDomains.canonical);
  expect(getRedirectUrl(await proxy(new NextRequest("https://arbitrary-preview.vercel.app/")))).toBeNull();
});

it("keeps existing public instruction PDF links downloadable without a session transfer", async () => {
  const path = "/Rejestracja_Ryanair_Instrukcja.pdf";
  const response = await proxy(new NextRequest(`${siteDomains.legacy}${path}?token=private`));
  expect(getRedirectUrl(response)).toBe(`${siteDomains.canonical}${path}`);
  expect(response.status).toBe(303);
  expect(enabled).not.toHaveBeenCalled();
  expect(getRedirectUrl(await proxy(new NextRequest(`${siteDomains.canonical}${path}`)))).toBeNull();
});

it("never accepts arbitrary redirects or private query data as a destination", () => {
  for (const input of ["https://evil.test", "//evil.test", "/\\evil.test", "/admin", "/api/files/id", "/session-transfer/start", "/step-3-task/../admin"]) expect(migrationDestination(input)).toBe("/");
  expect(migrationDestination("/step-2?utm_source=facebook&account=1&token=secret#private")).toBe("/step-2?utm_source=facebook&account=1");
});

it("retains campaign tags and distinguishes the new preland from internal application hosts", () => {
  const target = `${siteDomains.canonical}/?utm_source=facebook&utm_medium=cpc&utm_campaign=test`;
  expect(collectVisitorAttribution(target, `${siteDomains.legacy}/step-3-task`)).toMatchObject({ utmSource: "facebook", utmMedium: "cpc", utmCampaign: "test", referrerHost: null });
  expect(collectVisitorAttribution(target, `${siteDomains.preland}/index.html`)).toMatchObject({ referrerHost: "land.itsolution.fun" });
});
