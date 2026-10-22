import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { POST } from "@/app/api/admin/documents/generate/route";
import { AppError } from "@/server/errors";
import { contractDataSchema } from "@/lib/documents";
import { setupTestEnv } from "./helpers";

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  render: vi.fn<(data: unknown) => Promise<Uint8Array>>(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => mocks.jar.has(name) ? { value: mocks.jar.get(name)! } : undefined,
}) }));
vi.mock("@/server/documents/pdf", () => ({ generateContractPdf: mocks.render }));

const sessionSecret = "documents-api-test-secret-at-least-thirty-two-characters";
const valid = { date: "2026-10-22", fullName: "Jan Kowalski", address: "ul. Długa 10, 20-001 Lublin" };
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%%EOF");
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let owner: typeof schema.adminUsers.$inferSelect;
let temporary: typeof schema.adminUsers.$inferSelect;

function request(body: unknown = valid, headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/admin/documents/generate", {
    method: "POST",
    headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function authenticate(admin = owner) {
  mocks.jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion })
    .setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(sessionSecret)));
}

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", sessionSecret);
  mocks.jar.clear();
  mocks.render.mockReset().mockResolvedValue(pdfBytes);
  await env.db.delete(schema.adminUsers);
  [owner, temporary] = await env.db.insert(schema.adminUsers).values([
    { email: "owner@example.test", passwordHash: "unused" },
    { email: "temporary@example.test", passwordHash: "unused", isTemporary: true },
  ]).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

describe("private document-generation API", () => {
  it("requires a real primary-admin session before reading fields or rendering", async () => {
    const anonymous = request();
    const response = await POST(anonymous);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(anonymous.bodyUsed).toBe(false);

    mocks.jar.set("nl_admin", "forged");
    expect((await POST(request())).status).toBe(401);
    await authenticate(temporary);
    const forbidden = request(null, { "content-length": "5000" });
    expect((await POST(forbidden)).status).toBe(403);
    expect(forbidden.bodyUsed).toBe(false);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("checks the current DB permission and token version on every request", async () => {
    await authenticate();
    await env.db.update(schema.adminUsers).set({ isTemporary: true }).where(eq(schema.adminUsers.id, owner.id));
    expect((await POST(request())).status).toBe(403);
    await env.db.update(schema.adminUsers).set({ isTemporary: false, tokenVersion: owner.tokenVersion + 1 }).where(eq(schema.adminUsers.id, owner.id));
    expect((await POST(request())).status).toBe(401);
    await env.db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, owner.id));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { origin: "https://other.example" },
    { origin: "http://example.com" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects cross-site and downgrade requests before rendering (%j)", async headers => {
    await authenticate();
    const req = request(valid, headers);
    const response = await POST(req);
    expect(response.status).toBe(403);
    expect(req.bodyUsed).toBe(false);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("returns a private PDF attachment with a neutral filename and normalized fields", async () => {
    await authenticate();
    const response = await POST(request({
      ...valid, fullName: "  Jan   Kowalski  ", address: " ul. Długa 10,  20-001 Lublin ",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Umowa_2026-10-22.pdf"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-length")).toBe(String(pdfBytes.byteLength));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(mocks.render).toHaveBeenCalledExactlyOnceWith(valid);
    expect(env.blobs.size).toBe(0);
    expect(env.queued).toEqual([]);
    for (const table of [schema.files, schema.leads, schema.appSettings, schema.rateLimits]) {
      expect(await env.db.select().from(table)).toEqual([]);
    }
  });

  it.each([
    null, [], {}, { ...valid, fullName: 5 }, { ...valid, address: "abc" },
    { ...valid, fullName: "a" }, { ...valid, fullName: "x".repeat(161) },
    { ...valid, address: "x".repeat(301) }, { ...valid, address: "ul. Długa\nLublin" },
    { ...valid, fullName: "Jan\u0000Kowalski" }, { ...valid, fullName: "Jan\u202eKowalski" },
    { ...valid, date: "2026-02-29" }, { ...valid, isTemporary: false },
  ])("rejects malformed or unsafe fields without rendering (%j)", async body => {
    await authenticate();
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "contract_invalid", error: "Check the date, full name and address." });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, unsupported media, and oversized declared or actual bodies", async () => {
    await authenticate();
    const malformed = new Request("https://example.com/api/admin/documents/generate", {
      method: "POST", headers: { host: "example.com", origin: "https://example.com", "content-type": "application/json" }, body: "not JSON",
    });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request(valid, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(valid, { "content-length": "4097" }))).status).toBe(413);
    const oversized = request({ ...valid, address: "x".repeat(5000) });
    expect(oversized.headers.get("content-length")).toBeNull();
    expect((await POST(oversized)).status).toBe(413);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("keeps layout failures safe and suppresses personal data in unexpected renderer errors", async () => {
    await authenticate();
    mocks.render.mockRejectedValueOnce(new AppError(400, "document_layout", "Text does not fit the document."));
    const layout = await POST(request());
    expect(layout.status).toBe(400);
    expect(await layout.json()).toEqual({ code: "document_layout", error: "Text does not fit the document." });

    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.render.mockRejectedValueOnce(new Error(`Unexpected failure for ${valid.fullName} at ${valid.address}`));
      const failed = await POST(request());
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({
        code: "document_generation_failed", error: "The PDF could not be generated. Please try again.",
      });
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});

describe("shared contract field validation", () => {
  it.each(["1900-01-01", "2000-02-29", "2024-02-29", "2100-12-31"])("accepts a real ISO calendar date (%s)", date => {
    expect(contractDataSchema.safeParse({ ...valid, date }).success).toBe(true);
  });

  it.each(["1899-12-31", "2101-01-01", "1900-02-29", "2100-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "2026-01-00", "22.10.2026", "2026-1-01", "2026-10-22T00:00:00Z"])("rejects invalid or ambiguous dates (%s)", date => {
    expect(contractDataSchema.safeParse({ ...valid, date }).success).toBe(false);
  });

  it("normalizes decomposed Polish names without losing diacritics", () => {
    const input = { ...valid, fullName: "Łucja Żuk".normalize("NFD") };
    expect(contractDataSchema.parse(input).fullName).toBe("Łucja Żuk");
  });
});
