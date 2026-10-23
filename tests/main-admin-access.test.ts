import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { changePassword, getAdmin, hashPassword, login, replaceMainAdminAccess } from "@/server/admin-auth";
import { PUT } from "@/app/api/admin/account/route";
import { POST as changeOwnPassword } from "@/app/api/admin/password/route";
import { GET as getMe } from "@/app/api/admin/me/route";
import { createTestAccount, listTestAccounts } from "@/server/services/test-access";
import { saveContact } from "@/server/services/contact";
import { newSession, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
  delete: (name: string) => jar.delete(name),
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let main: typeof schema.adminUsers.$inferSelect;
let passwordHash: string;
const currentPassword = "old-owner-password-123";
const nextPassword = "new-owner-password-456";
const nextEmail = "new-owner@example.test";
beforeAll(async () => { env = await setupTestEnv(); passwordHash = await hashPassword(currentPassword); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", "owner-replacement-test-secret-more-than-thirty-two-characters");
  vi.stubEnv("ADMIN_EMAIL", "original-owner@example.test");
  vi.stubEnv("ADMIN_PASSWORD", currentPassword);
  jar.clear();
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.rateLimits);
  [main] = await env.db.insert(schema.adminUsers).values({ email: "original-owner@example.test", passwordHash }).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });
const authenticate = () => login({ email: main.email, password: currentPassword }, "owner-sign-in");
const input = () => ({ email: nextEmail, currentPassword, newPassword: nextPassword });
const request = (body: unknown, origin = "https://example.com") => new Request("https://example.com/api/admin/account", {
  method: "PUT", headers: { host: "example.com", origin, "content-type": "application/json", "x-forwarded-for": "owner-action-ip" }, body: JSON.stringify(body),
});
const stored = async () => (await env.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, main.id)))[0];

describe("replacement of the main administrator's credentials", () => {
  it("keeps the same account, permissions, leads and staff, revokes old logins and tokens, and refreshes the current session", async () => {
    const sid = await newSession(env.db);
    await saveContact(sid, { name: "Kandydat Testowy", phone: "600123456" });
    const leads = await env.db.select().from(schema.leads);
    const staff = await createTestAccount(main.id);
    await authenticate();
    const oldToken = jar.get("nl_admin")!;
    const response = await PUT(request({ ...input(), email: `  ${nextEmail.toUpperCase()}  ` }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ email: nextEmail });
    expect(await getAdmin()).toMatchObject({ id: main.id, email: nextEmail, isTemporary: false });
    const newToken = jar.get("nl_admin")!;
    expect(newToken).not.toBe(oldToken);
    const row = await stored();
    expect(row.tokenVersion).toBe(main.tokenVersion + 1);
    expect(row.passwordHash).not.toContain(nextPassword);
    expect(await bcrypt.compare(nextPassword, row.passwordHash)).toBe(true);
    expect(await env.db.select().from(schema.leads)).toEqual(leads);
    expect((await listTestAccounts(main.id))[0].id).toBe(staff.account.id);
    expect(await env.db.select().from(schema.adminUsers)).toHaveLength(2);
    jar.set("nl_admin", oldToken);
    expect(await getAdmin()).toBeNull();
    const staleRequest = request(input());
    expect((await PUT(staleRequest)).status).toBe(401); expect(staleRequest.bodyUsed).toBe(false);
    for (const [email, password] of [[main.email, currentPassword], [main.email, nextPassword], [nextEmail, currentPassword]]) {
      await expect(login({ email, password }, "old-login-ip")).rejects.toMatchObject({ status: 401 });
    }
    await login({ email: nextEmail, password: nextPassword }, "new-login-ip");
    expect(await getAdmin()).toMatchObject({ id: main.id, isTemporary: false });
    await login({ email: staff.account.email, password: staff.password }, "staff-ip");
    expect(await getAdmin()).toMatchObject({ id: staff.account.id, isTemporary: true });
  });

  it("denies anonymous and additional administrators before reading the replacement payload, while preserving staff password changes", async () => {
    const anonymous = request(input());
    expect((await PUT(anonymous)).status).toBe(401); expect(anonymous.bodyUsed).toBe(false);
    const staff = await createTestAccount(main.id);
    await login({ email: staff.account.email, password: staff.password }, "staff-ip");
    const denied = request({ ...input(), adminId: main.id });
    expect((await PUT(denied)).status).toBe(403); expect(denied.bodyUsed).toBe(false);
    await expect(replaceMainAdminAccess(staff.account.id, input(), "staff-ip")).rejects.toMatchObject({ status: 403, code: "main_access_forbidden" });
    expect(await (await getMe()).json()).toMatchObject({ admin: { email: staff.account.email, isTemporary: true } });
    expect((await changeOwnPassword(request({ currentPassword: staff.password, newPassword: nextPassword }))).status).toBe(200);
    expect(await getAdmin()).toMatchObject({ id: staff.account.id, isTemporary: true });
    expect(await stored()).toEqual(main);
  });

  it("rejects cross-origin changes, malformed fields, reused passwords and wrong current passwords without changing credentials", async () => {
    await authenticate();
    const token = jar.get("nl_admin");
    expect((await PUT(request(input(), "https://attacker.example"))).status).toBe(403);
    for (const body of [
      { ...input(), email: "not-an-email" }, { ...input(), isTemporary: false },
      { ...input(), newPassword: "short" }, { ...input(), newPassword: "я".repeat(37) },
    ]) expect((await PUT(request(body))).status).toBe(400);
    // Start a fresh attempt window for the password-specific validations.
    await env.db.delete(schema.rateLimits);
    expect(await (await PUT(request({ ...input(), newPassword: currentPassword }))).json()).toMatchObject({ code: "password_unchanged" });
    expect(await (await PUT(request({ ...input(), currentPassword: "wrong-password" }))).json()).toMatchObject({ code: "wrong_password" });
    expect(await stored()).toEqual(main);
    expect(jar.get("nl_admin")).toBe(token);
    expect(await getAdmin()).toMatchObject({ id: main.id });
  });

  it("never overwrites or merges an existing account when the requested email belongs to staff", async () => {
    const [staff] = await env.db.insert(schema.adminUsers).values({ email: nextEmail, passwordHash, isTemporary: true }).returning();
    await authenticate();
    const response = await PUT(request(input()));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "admin_email_in_use" });
    expect(await stored()).toEqual(main);
    expect((await env.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, staff.id)))[0]).toEqual(staff);
    expect(await getAdmin()).toMatchObject({ id: main.id, email: main.email });
  });

  it("allows only one concurrent replacement of the same account", async () => {
    await authenticate();
    const results = await Promise.allSettled(["first", "second"].map(prefix => replaceMainAdminAccess(main.id, { ...input(), email: `${prefix}@example.test`, newPassword: `${prefix}-new-password-123` }, "race-ip")));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 400, code: "wrong_password" } });
    expect((await stored()).tokenVersion).toBe(main.tokenVersion + 1);
    expect(await getAdmin()).toMatchObject({ id: main.id, email: (await stored()).email });
  });

  it("handles concurrent email collisions atomically, preserving the losing account", async () => {
    const [other] = await env.db.insert(schema.adminUsers).values({ email: "other-owner@example.test", passwordHash }).returning();
    const results = await Promise.allSettled([main.id, other.id].map(id => replaceMainAdminAccess(id, input(), "collision-ip")));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409, code: "admin_email_in_use" } });
    const rows = await env.db.select().from(schema.adminUsers);
    expect(rows.filter(row => row.email === nextEmail)).toHaveLength(1);
    expect(rows.filter(row => row.tokenVersion === main.tokenVersion + 1)).toHaveLength(1);
    const unchanged = rows.filter(row => row.tokenVersion === main.tokenVersion);
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0]).toEqual(unchanged[0].id === main.id ? main : other);
  });

  it("limits failed reauthentication attempts across IP addresses", async () => {
    await authenticate();
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(replaceMainAdminAccess(main.id, { ...input(), currentPassword: "wrong-password" }, `ip-${attempt}`)).rejects.toMatchObject({ code: "wrong_password" });
    await expect(replaceMainAdminAccess(main.id, input(), "fresh-ip")).rejects.toMatchObject({ status: 429 });
    expect(await stored()).toEqual(main);
  });

  it("rolls back both fields on database failures and keeps credentials out of diagnostics", async () => {
    await authenticate();
    await env.client.exec("CREATE FUNCTION reject_owner_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary database failure'; END $$; CREATE TRIGGER reject_owner_change BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION reject_owner_change();");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await PUT(request(input()));
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ code: "main_access_failed" });
      expect(warn).toHaveBeenCalledExactlyOnceWith("admin.credentials_change_failed");
      expect(errors).not.toHaveBeenCalled();
      expect(await stored()).toEqual(main);
      expect(await getAdmin()).toMatchObject({ id: main.id, email: main.email });
    } finally {
      await env.client.exec("DROP TRIGGER reject_owner_change ON admin_users; DROP FUNCTION reject_owner_change();");
      warn.mockRestore(); errors.mockRestore();
    }
  });

  it("allows the owner to keep the current email when rotating only the password", async () => {
    await authenticate();
    expect((await PUT(request({ ...input(), email: main.email }))).status).toBe(200);
    await expect(login({ email: main.email, password: currentPassword }, "old-ip")).rejects.toMatchObject({ status: 401 });
    await login({ email: main.email, password: nextPassword }, "new-ip");
    expect(await getAdmin()).toMatchObject({ id: main.id, email: main.email, isTemporary: false });
    // The existing password-only API remains compatible with the newly issued owner session.
    await changePassword(main.id, { currentPassword: nextPassword, newPassword: "another-new-password-789" }, "owner-ip");
    expect(await getAdmin()).toMatchObject({ id: main.id });
  });
});
