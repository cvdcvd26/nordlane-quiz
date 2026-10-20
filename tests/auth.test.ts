import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestEnv } from "./helpers";
import { schema } from "@/db";
import { login, getAdmin, changePassword, logout, passwordSchema } from "@/server/admin-auth";
import { getOrCreateVisitorSessionId, getVisitorSessionId } from "@/server/visitor-session";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), options: new Map<string, Record<string, unknown>>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.values.has(name) ? { value: jar.values.get(name)! } : undefined,
  set: (name: string, value: string, options: Record<string, unknown>) => { jar.values.set(name, value); jar.options.set(name, options); },
  delete: (name: string) => jar.values.delete(name),
}) }));
let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-secret-with-more-than-thirty-two-characters");
  vi.stubEnv("ADMIN_EMAIL", "admin@example.com"); vi.stubEnv("ADMIN_PASSWORD", "test-password-123");
  jar.values.clear(); jar.options.clear();
  await env.db.delete(schema.adminUsers); await env.db.delete(schema.rateLimits);
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

it("bootstraps the admin, hashes the password, invalidates old sessions and logs out", async () => {
  await login({ email: "ADMIN@example.com", password: "test-password-123" }, "auth-test");
  expect(jar.options.get("nl_admin")).toMatchObject({ httpOnly: true, sameSite: "strict" });
  const admin = (await getAdmin())!;
  expect(admin.email).toBe("admin@example.com");
  const [stored] = await env.db.select().from(schema.adminUsers);
  expect(stored.passwordHash).not.toContain("test-password-123");
  const oldCookie = jar.values.get("nl_admin")!;
  await changePassword(admin.id, { currentPassword: "test-password-123", newPassword: "different-password-456" }, "auth-test");
  const newCookie = jar.values.get("nl_admin")!;
  jar.values.set("nl_admin", oldCookie); expect(await getAdmin()).toBeNull();
  jar.values.set("nl_admin", newCookie); expect((await getAdmin())?.id).toBe(admin.id);
  await logout(); expect(await getAdmin()).toBeNull();
});
it("rate-limits repeated bad passwords", async () => {
  for (let i = 0; i < 5; i++) await expect(login({ email: "bad@example.com", password: "wrong" }, "bad-ip")).rejects.toMatchObject({ status: 401 });
  await expect(login({ email: "bad@example.com", password: "wrong" }, "bad-ip")).rejects.toMatchObject({ status: 429 });
});
it("rejects passwords that bcrypt would silently truncate, including multibyte text", () => {
  expect(passwordSchema.safeParse("a".repeat(72)).success).toBe(true);
  expect(passwordSchema.safeParse("a".repeat(73)).success).toBe(false);
  expect(passwordSchema.safeParse("я".repeat(37)).success).toBe(false);
});
it("stores a visitor token hash, restores its session and expires old sessions", async () => {
  const id = await getOrCreateVisitorSessionId("visitor-test");
  expect(await getVisitorSessionId()).toBe(id);
  const [session] = await env.db.select().from(schema.visitorSessions).where(eq(schema.visitorSessions.id, id));
  expect(session.tokenHash).not.toBe(jar.values.get("nl_visitor"));
  await env.db.update(schema.visitorSessions).set({ createdAt: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000) }).where(eq(schema.visitorSessions.id, id));
  expect(await getVisitorSessionId()).toBeNull();
  jar.values.set("nl_visitor", "tampered"); expect(await getVisitorSessionId()).toBeNull();
});
