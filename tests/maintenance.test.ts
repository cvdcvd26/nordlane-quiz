import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { defaultSettings } from "@/config/settings";
import { assertVisitorAvailable, getMaintenanceState, isMaintenanceEnabled, updateMaintenance } from "@/server/maintenance";
import { getSettings } from "@/server/settings";
import { json, route } from "@/server/http";
import { GET as getMaintenance, PUT as putMaintenance } from "@/app/api/admin/maintenance/route";
import { GET as getPublicMaintenance } from "@/app/api/maintenance/route";
import { GET as getSession } from "@/app/api/session/route";
import { PUT as putContact } from "@/app/api/contact/route";
import { PUT as putAnswer } from "@/app/api/quiz/answer/route";
import { POST as postSubmission } from "@/app/api/submit/route";
import { POST as postUpload } from "@/app/api/uploads/route";
import { DELETE as deleteUpload } from "@/app/api/uploads/[id]/route";
import { GET as getChat, POST as postChat } from "@/app/api/chat/route";
import { GET as getTestimonials } from "@/app/api/testimonials/route";
import { GET as getFile } from "@/app/api/files/[id]/route";
import { GET as getAdminMe } from "@/app/api/admin/me/route";
import { GET as getGeneralSettings, PUT as putGeneralSettings } from "@/app/api/admin/settings/route";
import { setupTestEnv, newSession, PNG } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
  delete: (name: string) => jar.delete(name),
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let owner: typeof schema.adminUsers.$inferSelect;
let temporary: typeof schema.adminUsers.$inferSelect;
const sessionSecret = "maintenance-test-secret-with-at-least-thirty-two-characters";
const request = (method = "GET", body?: unknown, origin = "https://example.com") => new Request("https://example.com/api/admin/maintenance", {
  method, headers: { host: "example.com", origin, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const context = (id: string = randomUUID()) => ({ params: Promise.resolve({ id }) });
async function authenticate(admin = owner) {
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion })
    .setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(sessionSecret)));
}

beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", sessionSecret);
  jar.clear();
  env.blobs.clear();
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.appSettings);
  await env.db.delete(schema.rateLimits);
  [owner, temporary] = await env.db.insert(schema.adminUsers).values([
    { email: "owner@example.com", passwordHash: "unused" },
    { email: "temporary@example.com", passwordHash: "unused", isTemporary: true },
  ]).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

describe("owner-controlled maintenance state", () => {
  it("defaults to off, persists one independent setting, and exposes only public availability", async () => {
    expect(await getMaintenanceState()).toEqual({ enabled: false, updatedAt: null });
    expect(await isMaintenanceEnabled()).toBe(false);
    const initial = await getPublicMaintenance();
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toEqual({ enabled: false });
    await authenticate();
    const response = await putMaintenance(request("PUT", { enabled: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const saved = await response.json();
    expect(saved).toEqual({ canManage: true, enabled: true, updatedAt: expect.any(String) });
    expect(Number.isFinite(Date.parse(saved.updatedAt))).toBe(true);
    expect(await getMaintenanceState()).toEqual({ enabled: true, updatedAt: saved.updatedAt });
    const listing = await getMaintenance();
    expect(listing.headers.get("cache-control")).toBe("private, no-store");
    expect(await listing.json()).toEqual(saved);
    expect(await (await getPublicMaintenance()).json()).toEqual({ enabled: true });
    expect(await env.db.select().from(schema.appSettings)).toHaveLength(1);
    expect(await getSettings()).toEqual(defaultSettings);
    expect((await putMaintenance(request("PUT", { enabled: false }))).status).toBe(200);
    expect(await isMaintenanceEnabled()).toBe(false);
    expect(await env.db.select().from(schema.appSettings)).toHaveLength(1);
    await expect(assertVisitorAvailable()).resolves.toBeUndefined();
  });

  it("requires authentication, hides control from temporary admins, and authorizes again in the service", async () => {
    expect((await getMaintenance()).status).toBe(401);
    expect((await putMaintenance(request("PUT", { enabled: true }))).status).toBe(401);
    await authenticate(temporary);
    const hidden = await getMaintenance();
    expect(hidden.headers.get("cache-control")).toBe("private, no-store");
    expect(await hidden.json()).toEqual({ canManage: false });
    const denied = await putMaintenance(request("PUT", { enabled: true }));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "test_access_forbidden" });
    await expect(updateMaintenance(temporary.id, { enabled: true })).rejects.toMatchObject({ status: 403, code: "maintenance_forbidden" });
    await expect(updateMaintenance(randomUUID(), { enabled: true })).rejects.toMatchObject({ status: 401 });
    expect(await getMaintenanceState()).toEqual({ enabled: false, updatedAt: null });

    // A formerly permanent account cannot retain control after its permission changes in the DB.
    await authenticate();
    await env.db.update(schema.adminUsers).set({ isTemporary: true }).where(eq(schema.adminUsers.id, owner.id));
    expect(await (await getMaintenance()).json()).toEqual({ canManage: false });
    expect((await putMaintenance(request("PUT", { enabled: true }))).status).toBe(403);
  });

  it("rejects CSRF, loose values, unknown fields, and malformed JSON without changing state", async () => {
    await authenticate();
    expect((await putMaintenance(request("PUT", { enabled: true }, "https://other.example"))).status).toBe(403);
    for (const input of [{ enabled: "true" }, { enabled: 1 }, {}, null, { enabled: true, canManage: true }]) {
      expect((await putMaintenance(request("PUT", input))).status).toBe(400);
    }
    const invalid = new Request("https://example.com/api/admin/maintenance", {
      method: "PUT", headers: { host: "example.com", origin: "https://example.com" }, body: "invalid-json",
    });
    expect((await putMaintenance(invalid)).status).toBe(400);
    expect(await getMaintenanceState()).toEqual({ enabled: false, updatedAt: null });
  });

  it("cannot be enabled or disabled by a forged general-settings request from another administrator", async () => {
    await authenticate(temporary);
    expect((await putGeneralSettings(request("PUT", { ...defaultSettings, maintenanceEnabled: true }))).status).toBe(200);
    expect(await isMaintenanceEnabled()).toBe(false);
    await updateMaintenance(owner.id, { enabled: true });
    expect((await putGeneralSettings(request("PUT", { ...defaultSettings, maintenanceEnabled: false }))).status).toBe(200);
    expect(await isMaintenanceEnabled()).toBe(true);
    expect(await (await getGeneralSettings()).json()).toEqual({ settings: defaultSettings });
    expect(await getSettings()).not.toHaveProperty("maintenanceEnabled");
  });
});

describe("visitor API maintenance boundary", () => {
  it("blocks every existing public endpoint before any sessions, writes, uploads, or rate-limit effects", async () => {
    await updateMaintenance(owner.id, { enabled: true });
    const handlers: [string, () => Promise<Response>][] = [
      ["session", () => getSession(request())],
      ["contact", () => putContact(request("PUT", { name: "Candidate", phone: "500000009" }))],
      ["quiz.answer", () => putAnswer(request("PUT", { questionKey: "one", answer: "yes" }))],
      ["submit", () => postSubmission(request("POST", {}))],
      ["uploads", () => postUpload(request("POST", {}))],
      ["uploads.delete", () => deleteUpload(request("DELETE"), context())],
      ["chat.get", () => getChat(request())],
      ["chat.post", () => postChat(request("POST", { body: "Hello" }))],
      ["testimonials.list", () => getTestimonials()],
      ["files.get", () => getFile(request(), context())],
    ];
    for (const [scope, handler] of handlers) {
      const response = await handler();
      expect(response.status, scope).toBe(503);
      expect(response.headers.get("cache-control"), scope).toBe("no-store");
      expect(response.headers.get("retry-after"), scope).toBe("60");
      expect(await response.json(), scope).toEqual({ code: "maintenance", error: expect.any(String) });
    }
    for (const table of [schema.visitorSessions, schema.visitorContacts, schema.quizAnswers, schema.taskSubmissions,
      schema.leads, schema.conversations, schema.messages, schema.files, schema.rateLimits]) {
      expect(await env.db.select().from(table)).toEqual([]);
    }
    expect(jar.size).toBe(0);
    expect(env.blobs.size).toBe(0);
    expect(env.queued).toEqual([]);
  });

  it("keeps admin and system scopes available, without allowing an admin to bypass visitor-only APIs", async () => {
    await updateMaintenance(owner.id, { enabled: true });
    await authenticate();
    expect((await getAdminMe()).status).toBe(200);
    expect((await getGeneralSettings()).status).toBe(200);
    expect((await getMaintenance()).status).toBe(200);
    expect((await getPublicMaintenance()).status).toBe(200);
    const job = vi.fn(async () => json({ delivered: true }));
    expect((await route("jobs.deliver", job)()).status).toBe(200);
    expect(job).toHaveBeenCalledOnce();
    expect((await getSession(request())).status).toBe(503);
    await expect(assertVisitorAvailable()).rejects.toMatchObject({ status: 503, code: "maintenance" });
    expect((await putMaintenance(request("PUT", { enabled: false }))).status).toBe(200);
    const session = await getSession(request());
    expect(session.status).toBe(200);
    expect(await env.db.select().from(schema.visitorSessions)).toHaveLength(1);
  });

  it("allows authenticated admins to read shared private files, but never anonymous, forged, or revoked sessions", async () => {
    const sessionId = await newSession(env.db);
    const [file] = await env.db.insert(schema.files).values({
      sessionId, purpose: "submission", uploadedBy: "visitor", storageKey: "maintenance-test.png",
      originalName: "test.png", mimeType: "image/png", sizeBytes: PNG.length,
    }).returning();
    env.blobs.set(file.storageKey, PNG);
    await updateMaintenance(owner.id, { enabled: true });
    expect((await getFile(request(), context(file.id))).status).toBe(503);
    jar.set("nl_admin", "forged");
    expect((await getFile(request(), context(file.id))).status).toBe(503);
    for (const admin of [owner, temporary]) {
      await authenticate(admin);
      await expect(assertVisitorAvailable({ allowAdmin: true })).resolves.toBeUndefined();
      const response = await getFile(request(), context(file.id));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
    }
    await env.db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, temporary.id));
    expect((await getFile(request(), context(file.id))).status).toBe(503);
  });
});
