import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getAdmin: vi.fn() }));
vi.mock("@/server/admin-auth", () => auth);
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock("@/components/admin/DocumentGenerator", () => ({ default: () => null }));

import DocumentsPage from "@/app/admin/(panel)/documents/page";

describe("owner-only document page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends an unauthenticated session to sign in before returning the generator", async () => {
    auth.getAdmin.mockResolvedValue(null);
    await expect(DocumentsPage()).rejects.toThrow("redirect:/admin/login");
  });

  it("returns a missing page for a valid additional administrator", async () => {
    auth.getAdmin.mockResolvedValue({ id: "staff", email: "staff@example.test", isTemporary: true });
    await expect(DocumentsPage()).rejects.toThrow("not-found");
  });

  it("does not infer owner access if the capability flag is missing", async () => {
    auth.getAdmin.mockResolvedValue({ id: "unknown", email: "unknown@example.test" });
    await expect(DocumentsPage()).rejects.toThrow("not-found");
  });

  it("returns the generator only for the authenticated main administrator", async () => {
    auth.getAdmin.mockResolvedValue({ id: "owner", email: "owner@example.test", isTemporary: false });
    const result = await DocumentsPage();
    expect(result).toMatchObject({ props: {} });
    expect(typeof result.type).toBe("function");
  });
});
