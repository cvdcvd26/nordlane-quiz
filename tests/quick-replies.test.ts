import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { defaultQuickReplies, quickRepliesUpdateSchema } from "@/lib/quick-replies";
import { getQuickReplies, updateQuickReplies } from "@/server/services/quick-replies";
import { getSettings } from "@/server/settings";
import { defaultSettings } from "@/config/settings";
import { GET, PUT } from "@/app/api/admin/quick-replies/route";
import { setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined }) }));
const secret = "quick-replies-test-secret-at-least-thirty-two-characters";
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let staff: typeof schema.adminUsers.$inferSelect;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret); jar.clear();
  await env.db.delete(schema.appSettings); await env.db.delete(schema.adminUsers); await env.db.delete(schema.rateLimits);
  [staff] = await env.db.insert(schema.adminUsers).values({ email: "staff@example.test", passwordHash: "unused", isTemporary: true }).returning();
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });
async function authenticate() {
  jar.set("nl_admin", await new SignJWT({ v: staff.tokenVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(staff.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
}
const request = (body: unknown, origin = "https://example.com") => new Request("https://example.com/api/admin/quick-replies", {
  method: "PUT", headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("shared quick reply templates", () => {
  it("defaults to Polish drafts, saves edits and an empty list, without affecting other settings", async () => {
    expect(await getQuickReplies()).toEqual({ revision: null, replies: defaultQuickReplies });
    const value = await updateQuickReplies({ revision: null, replies: [{ id: "test", title: "  Test  ", body: "  Prosimy o uzupełnienie informacji.  " }] });
    expect(value.replies[0]).toEqual({ id: "test", title: "Test", body: "Prosimy o uzupełnienie informacji." });
    expect(await getQuickReplies()).toEqual(value);
    expect(await getSettings()).toEqual(defaultSettings);
    const empty = await updateQuickReplies({ revision: value.revision, replies: [] });
    expect((await getQuickReplies()).replies).toEqual([]);
    expect(empty.revision).not.toBe(value.revision);
    expect(await env.db.select().from(schema.messages)).toEqual([]);
  });

  it("prevents stale or concurrent administrators from overwriting each other's edits", async () => {
    const initial = { revision: null, replies: defaultQuickReplies };
    const concurrent = await Promise.allSettled([updateQuickReplies(initial), updateQuickReplies(initial)]);
    expect(concurrent.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409, code: "quick_replies_changed" } });
    const first = await getQuickReplies();
    await updateQuickReplies({ ...first, replies: [] });
    await expect(updateQuickReplies(first)).rejects.toMatchObject({ status: 409 });
  });

  it("requires an authenticated admin, permits staff, checks origin, and never sends a message", async () => {
    expect((await GET()).status).toBe(401);
    const denied = request({ revision: null, replies: [] });
    expect((await PUT(denied)).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    await authenticate();
    const initial = await GET();
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(initial.status).toBe(200);
    expect((await PUT(request({ revision: null, replies: [] }, "https://other.example"))).status).toBe(403);
    const saved = await PUT(request({ revision: null, replies: defaultQuickReplies }));
    expect(saved.status).toBe(200);
    expect((await saved.json()).replies).toEqual(defaultQuickReplies);
    expect(await env.db.select().from(schema.messages)).toEqual([]);
  });

  it("rejects invalid fields, duplicate IDs and excessive counts or text", () => {
    for (const replies of [
      [{ id: "x", title: "", body: "Text" }], [{ id: "../x", title: "Title", body: "Text" }],
      [{ id: "x", title: "Title", body: "x".repeat(2001) }],
      Array.from({ length: 13 }, (_, index) => ({ id: String(index), title: "Title", body: "Text" })),
      [defaultQuickReplies[0], defaultQuickReplies[0]],
    ]) expect(quickRepliesUpdateSchema.safeParse({ revision: null, replies }).success).toBe(false);
  });
});
