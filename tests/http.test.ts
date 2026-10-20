import { describe, expect, it, vi, afterEach } from "vitest";
import { assertSameOrigin, readJson } from "@/server/http";
import { readUploadedFile } from "@/server/multipart";
import { databaseDriver } from "@/lib/database-url";
import { appUrl } from "@/server/queue";
import { mergeMessages } from "@/lib/chat";
import { PNG } from "./helpers";

afterEach(() => vi.unstubAllEnvs());
const request = (headers: Record<string, string>) => new Request("https://example.com/api/contact", { method: "POST", headers: { host: "example.com", ...headers } });

describe("HTTP boundaries", () => {
  it("allows the same origin and rejects cross-origin and downgrade requests", () => {
    expect(() => assertSameOrigin(request({ origin: "https://example.com" }))).not.toThrow();
    expect(() => assertSameOrigin(request({ origin: "https://attacker.example" }))).toThrow();
    expect(() => assertSameOrigin(request({ origin: "http://example.com" }))).toThrow();
    expect(() => assertSameOrigin(request({ "sec-fetch-site": "cross-site" }))).toThrow();
  });
  it("limits the streamed JSON size without relying on Content-Length", async () => {
    await expect(readJson(new Request("http://localhost/api", { method: "POST", body: "x".repeat(33000) }))).rejects.toMatchObject({ status: 413 });
    expect(await readJson(new Request("http://localhost/api", { method: "POST", body: "invalid" }))).toBeNull();
    expect(await readJson(new Request("http://localhost/api", { method: "POST", body: '{"ok":true}' }))).toEqual({ ok: true });
  });
  it("reads a valid multipart upload and rejects oversized unlabelled bodies", async () => {
    const form = new FormData(); form.set("file", new File([new Uint8Array(PNG)], "test.png", { type: "image/png" }));
    const { file } = await readUploadedFile(new Request("http://localhost/api", { method: "POST", body: form }));
    expect(file.buffer.equals(PNG)).toBe(true);
    const tooBig = new Request("http://localhost/api", { method: "POST", body: new Uint8Array(5 * 1024 * 1024) });
    await expect(readUploadedFile(tooBig)).rejects.toMatchObject({ status: 413 });
  });
});

describe("deployment and cursor helpers", () => {
  it("uses pg for ordinary remote PostgreSQL and the Neon driver for Neon", () => {
    vi.stubEnv("DATABASE_DRIVER", "");
    expect(databaseDriver("postgresql://user:pass@db.render.com:5432/app")).toBe("postgres");
    expect(databaseDriver("postgresql://user:pass@[::1]:5432/app")).toBe("postgres");
    expect(databaseDriver("postgresql://user:pass@ep-test-pooler.eu-central-1.aws.neon.tech/app")).toBe("neon");
    expect(databaseDriver("postgresql://user:pass@proxy.example/app", "neon")).toBe("neon");
    expect(() => databaseDriver("postgresql://localhost/app", "invalid")).toThrow();
  });
  it("does not send a preview job to the production deployment", () => {
    vi.stubEnv("APP_URL", ""); vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "preview.example.com"); vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "production.example.com");
    expect(appUrl()).toBe("https://preview.example.com");
    vi.stubEnv("APP_URL", "https://custom.example.com/");
    expect(appUrl()).toBe("https://custom.example.com");
  });
  it("merges messages by sequence rather than rounded timestamps and deduplicates snapshots", () => {
    const at = new Date().toISOString();
    const first = { id: "z", sequence: "9007199254740992", createdAt: at };
    const second = { id: "a", sequence: "9007199254740993", createdAt: at };
    expect(mergeMessages([second], [first, second]).map(m => m.id)).toEqual(["z", "a"]);
  });
});
