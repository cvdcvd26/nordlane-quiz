import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { setupTestEnv, newSession } from "./helpers";
import { schema } from "@/db";
import { getAdmin, hashPassword, login, requirePermanentAdmin } from "@/server/admin-auth";
import { createTestAccount, deleteTestAccount, listTestAccounts } from "@/server/services/test-access";
import { saveContact } from "@/server/services/contact";
import { GET, POST } from "@/app/api/admin/test-access/route";
import { DELETE } from "@/app/api/admin/test-access/[id]/route";
import { GET as getMe } from "@/app/api/admin/me/route";
import { GET as getLeads } from "@/app/api/admin/leads/route";
import { PATCH as patchLead } from "@/app/api/admin/leads/[id]/route";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
  delete: (name: string) => jar.delete(name),
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let main: typeof schema.adminUsers.$inferSelect;
let mainHash: string;
const mainPassword = "main-test-password-123";
beforeAll(async () => { env = await setupTestEnv(); mainHash = await hashPassword(mainPassword); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-secret-with-more-than-thirty-two-characters");
  jar.clear();
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.rateLimits);
  [main] = await env.db.insert(schema.adminUsers).values({ email: "main@example.com", passwordHash: mainHash }).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

const request = (method: string, body?: unknown, origin = "https://example.com") => new Request("https://example.com/api/admin/test-access", {
  method, headers: { host: "example.com", origin, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const loginMain = () => login({ email: main.email, password: mainPassword }, "main-test-ip");

describe("removable temporary admin access", () => {
  it("creates independent strong credentials, stores only a hash, and permits regular admin operations", async () => {
    await loginMain();
    expect(await getAdmin()).toMatchObject({ id: main.id, isTemporary: false });
    const response = await POST(request("POST", {}));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const created = await response.json();
    expect(created.account.email).toMatch(/^test-[a-f0-9]{16}@alleybiz\.local$/);
    expect(created.password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Object.keys(created.account).sort()).toEqual(["createdAt", "email", "id"]);
    const [stored] = await env.db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, created.account.id));
    expect(stored.isTemporary).toBe(true);
    expect(stored.passwordHash).not.toBe(created.password);
    expect(await bcrypt.compare(created.password, stored.passwordHash)).toBe(true);
    expect(JSON.stringify(await listTestAccounts(main.id))).not.toContain(created.password);
    expect(JSON.stringify(await listTestAccounts(main.id))).not.toContain(stored.passwordHash);

    await login({ email: created.account.email, password: created.password }, "temporary-ip");
    expect(await getAdmin()).toMatchObject({ id: created.account.id, isTemporary: true });
    expect((await getMe()).status).toBe(200);
    expect((await getLeads(new Request("https://example.com/api/admin/leads"))).status).toBe(200);
    const sid = await newSession(env.db);
    await saveContact(sid, { name: "Test candidate", phone: "600123456" });
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    const updated = await patchLead(request("PATCH", { status: "in_progress" }), ctx(String(lead.id)));
    expect(updated.status).toBe(200);
    expect((await updated.json()).lead.status).toBe("in_progress");
  });

  it("hides access management from temporary admins and rejects creation or deletion, including self and main", async () => {
    const created = await createTestAccount(main.id);
    await login({ email: created.account.email, password: created.password }, "temporary-ip");
    expect(await (await GET()).json()).toEqual({ canManage: false, accounts: [] });
    await expect(requirePermanentAdmin()).rejects.toMatchObject({ status: 403, code: "test_access_forbidden" });
    const denied = await POST(request("POST", {}));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "test_access_forbidden" });
    for (const id of [created.account.id, main.id]) {
      expect((await DELETE(request("DELETE"), ctx(id))).status).toBe(403);
      await expect(deleteTestAccount(created.account.id, id)).rejects.toMatchObject({ code: "test_access_forbidden" });
    }
    await expect(createTestAccount(created.account.id)).rejects.toMatchObject({ code: "test_access_forbidden" });
    expect(await env.db.select().from(schema.adminUsers)).toHaveLength(2);
  });

  it("revokes every existing session and subsequent password login when the main admin deletes test access", async () => {
    const created = await createTestAccount(main.id);
    await login({ email: created.account.email, password: created.password }, "temporary-ip");
    const oldToken = jar.get("nl_admin")!;
    expect((await getAdmin())?.id).toBe(created.account.id);
    await loginMain();
    const listing = await GET();
    expect(listing.headers.get("cache-control")).toBe("private, no-store");
    expect(await listing.json()).toEqual({ canManage: true, accounts: [{
      ...created.account, createdAt: created.account.createdAt.toISOString(),
    }] });
    expect(await (await DELETE(request("DELETE"), ctx(created.account.id))).json()).toEqual({ ok: true });
    jar.set("nl_admin", oldToken);
    expect(await getAdmin()).toBeNull();
    expect((await getMe()).status).toBe(401);
    await expect(login({ email: created.account.email, password: created.password }, "deleted-ip")).rejects.toMatchObject({ status: 401 });
    expect(await listTestAccounts(main.id)).toEqual([]);
    await loginMain();
    expect(await getAdmin()).toMatchObject({ id: main.id, isTemporary: false });
  });

  it("never deletes permanent admins and validates account IDs and caller authentication", async () => {
    expect((await GET()).status).toBe(401);
    expect((await POST(request("POST", {}))).status).toBe(401);
    expect((await DELETE(request("DELETE"), ctx(main.id))).status).toBe(401);
    await loginMain();
    for (const id of [main.id, "invalid-id"]) {
      expect((await DELETE(request("DELETE"), ctx(id))).status).toBe(404);
    }
    const unknown = "00000000-0000-4000-8000-000000000000";
    await expect(createTestAccount(unknown)).rejects.toMatchObject({ status: 401 });
    expect(await env.db.select().from(schema.adminUsers)).toHaveLength(1);
    expect(await getAdmin()).toMatchObject({ id: main.id });
  });

  it("blocks cross-origin mutations and refuses caller-supplied credentials or permissions", async () => {
    await loginMain();
    expect((await POST(request("POST", {}, "https://attacker.example"))).status).toBe(403);
    expect((await POST(request("POST", { email: "chosen@example.com", password: "chosen-password", isTemporary: false }))).status).toBe(400);
    const created = await createTestAccount(main.id);
    expect((await DELETE(request("DELETE", undefined, "https://attacker.example"), ctx(created.account.id))).status).toBe(403);
    expect(await listTestAccounts(main.id)).toHaveLength(1);
  });

  it("limits account creation per main admin across requests", async () => {
    for (let n = 0; n < 5; n++) await createTestAccount(main.id);
    await expect(createTestAccount(main.id)).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(await listTestAccounts(main.id)).toHaveLength(5);
  });

  it("caps total active test accounts across different main admins and allows a replacement after deletion", async () => {
    const [otherMain] = await env.db.insert(schema.adminUsers).values({ email: "another-main@example.com", passwordHash: mainHash }).returning();
    await env.db.insert(schema.adminUsers).values(Array.from({ length: 9 }, (_, index) => ({
      email: `existing-${index}@alleybiz.local`, passwordHash: "unused", isTemporary: true,
    })));
    const simultaneous = await Promise.allSettled([createTestAccount(main.id), createTestAccount(otherMain.id)]);
    expect(simultaneous.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const denied = simultaneous.find((result) => result.status === "rejected");
    expect(denied && denied.status === "rejected" && denied.reason).toMatchObject({ status: 409, code: "test_access_limit" });
    await expect(createTestAccount(main.id)).rejects.toMatchObject({ status: 409, code: "test_access_limit" });
    const [existing] = await listTestAccounts(main.id);
    await deleteTestAccount(main.id, existing.id);
    expect((await createTestAccount(otherMain.id)).account.id).toBeTruthy();
    expect(await listTestAccounts(main.id)).toHaveLength(10);
  });
});
