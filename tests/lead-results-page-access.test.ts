import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getAdmin: vi.fn() }));
vi.mock("@/server/admin-auth", () => auth);
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock("@/components/admin/LeadResultsDashboard", () => ({ default: () => null }));

import ResultsPage from "@/app/admin/(panel)/results/page";

describe("owner-only lead results page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an anonymous session before returning the dashboard", async () => {
    auth.getAdmin.mockResolvedValue(null);
    await expect(ResultsPage()).rejects.toThrow("redirect:/admin/login");
  });

  it("returns a missing page for an authenticated additional administrator", async () => {
    auth.getAdmin.mockResolvedValue({ id: "staff", email: "staff@example.test", isTemporary: true });
    await expect(ResultsPage()).rejects.toThrow("not-found");
  });

  it("does not infer owner access when the permission flag is absent", async () => {
    auth.getAdmin.mockResolvedValue({ id: "unknown", email: "unknown@example.test" });
    await expect(ResultsPage()).rejects.toThrow("not-found");
  });

  it("returns the dashboard for the authenticated main administrator", async () => {
    auth.getAdmin.mockResolvedValue({ id: "owner", email: "owner@example.test", isTemporary: false });
    const result = await ResultsPage();
    expect(result).toMatchObject({ props: {} });
    expect(typeof result.type).toBe("function");
  });
});
