import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRedirectUrl, getRewrittenUrl, isRewrite, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), error: vi.fn() }));
vi.mock("@/server/maintenance", () => ({ isMaintenanceEnabled: mocks.enabled }));
vi.mock("@/server/log", () => ({ log: { error: mocks.error } }));

const origin = "https://alleybiz.example";
const request = (path: string, headers?: Record<string, string>) => new NextRequest(`${origin}${path}`, { headers });
const matches = (path: string) => unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `${origin}${path}` });
const protectedPaths = [
  "/", "/step-2", "/step-3-task", "/step-4-confirmation", "/cookie-policy", "/maintenance",
  "/Rejestracja_Ryanair_Instrukcja.pdf",
];
const assets = [
  "/favicon.ico", "/icon.svg", "/alleybiz-mark.svg",
  "/aneta-hr.png", "/maja-hr.png", "/hanna-hr.png", "/agnieszka-hr.png",
  "/_next/static/chunks/app.js", "/_next/static/media/font.woff2",
  "/_next/image?url=%2Fmaja-hr.png&w=64&q=75", "/_next/webpack-hmr",
];
const delegatedApis = [
  "/api", "/api/maintenance", "/api/admin/login", "/api/admin/maintenance",
  "/api/jobs/deliver", "/api/jobs/sweep", "/api/session", "/api/files/file-id",
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
});

describe("maintenance page Proxy", () => {
  it.each(protectedPaths)("replaces %s with a non-cacheable maintenance response", async (path) => {
    expect(matches(path)).toBe(true);
    const response = await proxy(request(`${path}?utm_source=test`));
    expect(response.status).toBe(503);
    if (path === "/maintenance") {
      expect(isRewrite(response)).toBe(false);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    } else {
      expect(isRewrite(response)).toBe(true);
      expect(getRewrittenUrl(response)).toBe(`${origin}/maintenance`);
    }
    expect(getRedirectUrl(response)).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(mocks.enabled).toHaveBeenCalledOnce();
  });

  it("finishes a rewritten maintenance destination without a self-rewrite loop", async () => {
    const rewritten = await proxy(request("/step-3-task"));
    const destination = getRewrittenUrl(rewritten);
    expect(destination).toBe(`${origin}/maintenance`);
    const response = await proxy(new NextRequest(destination!));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(isRewrite(response)).toBe(false);
    expect(response.headers.has("x-middleware-rewrite")).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.enabled).toHaveBeenCalledTimes(2);
  });

  it("allows ordinary requests immediately when maintenance is off", async () => {
    mocks.enabled.mockResolvedValue(false);
    for (const path of protectedPaths.filter((path) => path !== "/maintenance")) {
      const response = await proxy(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(isRewrite(response)).toBe(false);
      expect(getRedirectUrl(response)).toBeNull();
      expect(response.headers.has("retry-after")).toBe(false);
    }
  });

  it("redirects a direct maintenance URL home after the site reopens", async () => {
    mocks.enabled.mockResolvedValue(false);
    const response = await proxy(request("/maintenance?returnTo=https://other.example"));
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(`${origin}/`);
    expect(isRewrite(response)).toBe(false);
  });

  it("fails closed when the database availability check fails", async () => {
    mocks.enabled.mockRejectedValue(new Error("database unavailable"));
    const response = await proxy(request("/step-3-task"));
    expect(response.status).toBe(503);
    expect(getRewrittenUrl(response)).toBe(`${origin}/maintenance`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.error).toHaveBeenCalledWith("maintenance.proxy", "availability check failed");
  });

  it("does not accept a visitor-controlled maintenance bypass", async () => {
    const response = await proxy(request("/step-4-confirmation?maintenance=false&preview=true&admin=true", {
      cookie: "nl_admin=forged; maintenanceEnabled=false",
      "x-maintenance-bypass": "true",
      "x-admin": "true",
      "x-middleware-rewrite": `${origin}/`,
    }));
    expect(response.status).toBe(503);
    expect(getRewrittenUrl(response)).toBe(`${origin}/maintenance`);
    expect(mocks.enabled).toHaveBeenCalledOnce();
  });

  it.each([...assets, ...delegatedApis])("leaves %s to static resources or its API handler", async (path) => {
    expect(matches(path)).toBe(false);
    const response = await proxy(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(isRewrite(response)).toBe(false);
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it.each(["/administer", "/api-secret", "/_nextish", "/unknown.png", "/maja-hr.png/private", "/icon.svg/extra"])(
    "does not confuse %s with an exempt path",
    async (path) => {
      expect(matches(path)).toBe(true);
      expect((await proxy(request(path))).status).toBe(503);
      expect(mocks.enabled).toHaveBeenCalledOnce();
    },
  );
});

describe("admin access remains available during maintenance", () => {
  it("keeps the admin login page reachable without querying maintenance", async () => {
    expect(matches("/admin/login")).toBe(true);
    const response = await proxy(request("/admin/login"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it.each(["/admin", "/admin/settings", "/admin/leads/1"])("redirects %s without an admin cookie to login", async (path) => {
    expect(matches(path)).toBe(true);
    const response = await proxy(request(`${path}?filter=new`));
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(`${origin}/admin/login`);
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it("leaves actual admin authentication to the server API when a cookie exists", async () => {
    const response = await proxy(request("/admin/settings", { cookie: "nl_admin=opaque-session" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mocks.enabled).not.toHaveBeenCalled();
  });
});
