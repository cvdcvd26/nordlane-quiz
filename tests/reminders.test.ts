import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { clampReminderOffset, reminderCreateSchema, reminderUpdateSchema, toWarsawInput, warsawTimeCandidates } from "@/lib/reminders";
import { createReminder, deleteReminder, listReminders, reminderActivity, updateReminder } from "@/server/services/reminders";
import { GET as leadGET, POST } from "@/app/api/admin/leads/[id]/reminders/route";
import { DELETE, PATCH } from "@/app/api/admin/leads/[id]/reminders/[reminderId]/route";
import { GET } from "@/app/api/admin/reminders/route";
import { GET as activityGET } from "@/app/api/admin/activity/route";
import { newSession, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined }) }));
const secret = "reminders-test-secret-at-least-thirty-two-characters";
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let staff: typeof schema.adminUsers.$inferSelect;
let other: typeof schema.adminUsers.$inferSelect;
let leadId: number;
let otherLeadId: number;
const dueAt = "2030-02-10T12:00:00.000Z";
const createInput = { body: "  Oddzwonić do kandydata.  ", dueAt };
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret); jar.clear();
  await env.db.delete(schema.visitorSessions); await env.db.delete(schema.adminUsers); await env.db.delete(schema.rateLimits);
  [staff, other] = await env.db.insert(schema.adminUsers).values([
    { email: "staff@example.test", passwordHash: "unused", isTemporary: true },
    { email: "other@example.test", passwordHash: "unused" },
  ]).returning();
  const sessionId = await newSession(env.db);
  const otherSessionId = await newSession(env.db);
  [{ id: leadId }, { id: otherLeadId }] = await env.db.insert(schema.leads).values([{ sessionId }, { sessionId: otherSessionId }]).returning();
  await env.db.insert(schema.visitorContacts).values({ sessionId, name: "Anna", phone: "+48123456789" });
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });
async function authenticate(admin = staff) {
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
}
const ctx = () => ({ params: Promise.resolve({ id: String(leadId) }) });
const itemCtx = (id: string, lead = leadId) => ({ params: Promise.resolve({ id: String(lead), reminderId: id }) });
const request = (method: string, body?: unknown, origin = "https://example.com", path = `/leads/${leadId}/reminders`) => new Request(`https://example.com/api/admin${path}`, {
  method, headers: { host: "example.com", origin, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("shared lead reminders", () => {
  it("creates, edits, completes and reopens a shared reminder without assigning a manager or sending messages", async () => {
    await authenticate();
    const response = await POST(request("POST", createInput), ctx());
    expect(response.status).toBe(201);
    const { reminder } = await response.json();
    expect(reminder).toMatchObject({ leadId, body: "Oddzwonić do kandydata.", dueAt, revision: 0, completedAt: null });
    const [stored] = await env.db.select().from(schema.leadReminders);
    expect(stored.createdBy).toBe(staff.id);
    await authenticate(other);
    const shared = await leadGET(request("GET"), ctx());
    expect((await shared.json()).reminders[0]).toMatchObject({ id: reminder.id, name: "Anna" });
    expect(shared.headers.get("cache-control")).toBe("no-store");
    const edit = await PATCH(request("PATCH", { action: "edit", revision: 0, body: "Nowy termin", dueAt: "2030-03-10T12:00:00+01:00" }), itemCtx(reminder.id));
    expect(edit.status).toBe(200);
    expect((await edit.json()).reminder).toMatchObject({ body: "Nowy termin", dueAt: "2030-03-10T11:00:00.000Z", revision: 1 });
    const complete = await updateReminder(leadId, reminder.id, { action: "complete", revision: 1 });
    expect(complete.completedAt).toBeTruthy();
    expect((await listReminders({ filter: "done" })).total).toBe(1);
    const reopened = await updateReminder(leadId, reminder.id, { action: "reopen", revision: 2 });
    expect(reopened).toMatchObject({ completedAt: null, revision: 3 });
    expect((await listReminders({ filter: "upcoming" })).total).toBe(1);
    expect(await env.db.select().from(schema.messages)).toEqual([]);
  });

  it("rejects stale competing edits and deletes, and scopes every mutation to the specified lead", async () => {
    const reminder = await createReminder(leadId, staff.id, createInput);
    const concurrent = await Promise.allSettled([
      updateReminder(leadId, reminder.id, { action: "complete", revision: 0 }),
      updateReminder(leadId, reminder.id, { action: "edit", revision: 0, ...createInput }),
    ]);
    expect(concurrent.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.find(value => value.status === "rejected")).toMatchObject({ reason: { status: 409, code: "reminder_changed" } });
    await expect(deleteReminder(leadId, reminder.id, { revision: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(updateReminder(otherLeadId, reminder.id, { action: "reopen", revision: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(deleteReminder(otherLeadId, reminder.id, { revision: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(updateReminder(leadId, "invalid", { action: "reopen", revision: 1 })).rejects.toMatchObject({ status: 404 });
    expect(await deleteReminder(leadId, reminder.id, { revision: 1 })).toEqual({ deleted: true });
    await expect(deleteReminder(leadId, reminder.id, { revision: 1 })).rejects.toMatchObject({ status: 404 });
  });

  it("filters due, upcoming and done tasks with stable pagination and lead links", async () => {
    const now = Date.now();
    await env.db.insert(schema.leadReminders).values([
      ...Array.from({ length: 51 }, (_, index) => ({ leadId, body: `Due ${index}`, dueAt: new Date(now - (index + 1) * 60000) })),
      { leadId: otherLeadId, body: "Later", dueAt: new Date(now + 86400000) },
      { leadId, body: "Done", dueAt: new Date(now - 86400000), completedAt: new Date() },
    ]);
    const due = await listReminders({ filter: "due" });
    expect(due.counts).toEqual({ all: 53, due: 51, upcoming: 1, done: 1 });
    expect(due.reminders).toHaveLength(50);
    expect(due.reminders[0]).toMatchObject({ leadId, name: "Anna", body: "Due 50" });
    const second = await listReminders({ filter: "due", offset: 50 });
    expect(second.reminders).toHaveLength(1);
    expect(new Set([...due.reminders, ...second.reminders].map(row => row.id)).size).toBe(51);
    expect((await listReminders({ filter: "all" }, otherLeadId)).counts).toEqual({ all: 1, due: 0, upcoming: 1, done: 0 });
    await expect(listReminders({ filter: "all" }, 9999999)).rejects.toMatchObject({ status: 404 });
    await expect(createReminder(9999999, staff.id, createInput)).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a creator's shared tasks after account deletion and cascades candidate deletion", async () => {
    const reminder = await createReminder(leadId, staff.id, createInput);
    await env.db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, staff.id));
    const [stored] = await env.db.select().from(schema.leadReminders).where(eq(schema.leadReminders.id, reminder.id));
    expect(stored.createdBy).toBeNull();
    await env.db.delete(schema.leads).where(eq(schema.leads.id, leadId));
    expect(await env.db.select().from(schema.leadReminders)).toEqual([]);
  });

  it("returns to a valid page when another administrator removes the last result on page two", async () => {
    const dueAt = new Date(Date.now() - 60000);
    await env.db.insert(schema.leadReminders).values(Array.from({ length: 51 }, (_, index) => ({ leadId, body: `Due ${index}`, dueAt })));
    const secondPage = await listReminders({ filter: "due", offset: 50 });
    expect(secondPage.reminders).toHaveLength(1);
    const last = secondPage.reminders[0];
    await updateReminder(leadId, last.id, { action: "complete", revision: last.revision });
    const stalePage = await listReminders({ filter: "due", offset: 50 });
    expect(stalePage.total).toBe(50);
    expect(stalePage.reminders).toEqual([]);
    const offset = clampReminderOffset(stalePage.offset, stalePage.total);
    expect(offset).toBe(0);
    const validPage = await listReminders({ filter: "due", offset });
    expect(validPage.reminders).toHaveLength(50);
    expect(clampReminderOffset(100, 60)).toBe(50);
    expect(clampReminderOffset(50, 0)).toBe(0);
    expect(clampReminderOffset(50, 101)).toBe(50);
  });

  it("redacts private reminder parameters on insert and update failures without changing stored content", async () => {
    await authenticate();
    const existing = await createReminder(leadId, staff.id, createInput);
    const insertMarker = "PRIVATE_REMINDER_CREATE_c8fa1b";
    const updateMarker = "PRIVATE_REMINDER_UPDATE_84bd02";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.client.exec(`
      create function reject_reminder_write() returns trigger language plpgsql as $$ begin raise exception 'Simulated reminder failure'; end $$;
      create trigger reject_reminder_write before insert or update on lead_reminders for each row execute function reject_reminder_write();
    `);
    try {
      const created = await POST(request("POST", { ...createInput, body: insertMarker }), ctx());
      const updated = await PATCH(request("PATCH", { action: "edit", revision: existing.revision, dueAt: existing.dueAt, body: updateMarker }), itemCtx(existing.id));
      for (const response of [created, updated]) {
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ code: "reminder_failed" });
      }
      const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
      expect(logged).not.toContain(insertMarker); expect(logged).not.toContain(updateMarker);
      expect(logged).not.toContain("Failed query"); expect(logged).not.toContain("params:");
      expect(warn.mock.calls).toEqual([["reminders.create_failed"], ["reminders.update_failed"]]);
      expect(error).not.toHaveBeenCalled();
      const stored = await listReminders({ filter: "all" });
      expect(stored.reminders).toHaveLength(1);
      expect(stored.reminders[0]).toMatchObject({ id: existing.id, body: existing.body, revision: existing.revision });
    } finally {
      await env.client.exec("drop trigger if exists reject_reminder_write on lead_reminders; drop function if exists reject_reminder_write();");
      warn.mockRestore(); error.mockRestore();
    }
  });

  it("authenticates before reading request bodies, checks origin, validates payloads and rate limits mutations", async () => {
    expect((await GET(request("GET", undefined, undefined, "/reminders"))).status).toBe(401);
    expect((await activityGET(request("GET", undefined, undefined, "/activity"))).status).toBe(401);
    const denied = request("POST", createInput);
    expect((await POST(denied, ctx())).status).toBe(401);
    expect(denied.bodyUsed).toBe(false);
    await authenticate();
    expect((await POST(request("POST", createInput, "https://other.example"), ctx())).status).toBe(403);
    expect((await POST(request("POST", { ...createInput, body: " " }), ctx())).status).toBe(400);
    expect((await GET(request("GET", undefined, undefined, "/reminders?filter=invalid"))).status).toBe(400);
    const reminder = await createReminder(leadId, staff.id, createInput);
    expect((await PATCH(request("PATCH", { action: "complete", revision: 0 }, "https://other.example"), itemCtx(reminder.id))).status).toBe(403);
    expect((await DELETE(request("DELETE", { revision: 0 }), itemCtx(reminder.id, otherLeadId))).status).toBe(404);
    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
    await env.db.insert(schema.rateLimits).values({ key: `reminders:${staff.id}`, windowStart, count: 60 }).onConflictDoUpdate({ target: [schema.rateLimits.key, schema.rateLimits.windowStart], set: { count: 60 } });
    const limited = request("POST", createInput);
    expect((await POST(limited, ctx())).status).toBe(429);
    expect(limited.bodyUsed).toBe(false);
  });

  it("returns newly due and changed overdue reminders, never old or completed backlog as fresh alerts", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 60000);
    const old = new Date(now.getTime() - 86400000);
    await env.db.insert(schema.leadReminders).values([
      { leadId, body: "Old backlog", dueAt: old, createdAt: old, updatedAt: old },
      { leadId, body: "Newly due", dueAt: new Date(now.getTime() - 10000), createdAt: old, updatedAt: old },
      { leadId, body: "Reopened", dueAt: old, createdAt: old, updatedAt: new Date(now.getTime() - 1000) },
      { leadId, body: "Completed", dueAt: old, completedAt: now, updatedAt: now },
      { leadId, body: "Later", dueAt: new Date(now.getTime() + 86400000) },
    ]);
    const activity = await reminderActivity(since, now);
    expect(activity.dueReminderCount).toBe(3);
    expect(activity.reminders.map(row => row.body)).toEqual(["Reopened", "Newly due"]);
    expect((await reminderActivity(now, new Date(now.getTime() + 5000))).reminders).toEqual([]);
    await authenticate();
    const response = await activityGET(request("GET", undefined, undefined, `/activity?since=${since.toISOString()}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dueReminderCount: 3, reminders: expect.any(Array), leads: expect.any(Array) });
  });
});

describe("Warsaw reminder deadlines", () => {
  it("uses Warsaw wall time regardless of runtime zone and handles winter/summer offsets", () => {
    expect(toWarsawInput("2030-01-10T12:30:00.000Z")).toBe("2030-01-10T13:30");
    expect(toWarsawInput("2030-07-10T12:30:00.000Z")).toBe("2030-07-10T14:30");
    expect(warsawTimeCandidates("2030-01-10T13:30")).toEqual(["2030-01-10T12:30:00.000Z"]);
    expect(warsawTimeCandidates("2030-07-10T14:30")).toEqual(["2030-07-10T12:30:00.000Z"]);
  });
  it("rejects the spring DST gap and invalid dates and distinguishes both autumn occurrences", () => {
    expect(warsawTimeCandidates("2026-03-29T02:30")).toEqual([]);
    expect(warsawTimeCandidates("2026-10-25T02:30")).toEqual(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
    for (const value of ["2026-02-30T12:00", "2026-13-01T12:00", "2026-01-01T24:00", "bad", "1999-01-01T12:00"]) expect(warsawTimeCandidates(value)).toEqual([]);
  });
  it("requires explicit API offsets, bounded nonempty text and revisions, rejecting unapproved assignment fields", () => {
    for (const input of [
      { ...createInput, dueAt: "2030-02-10T12:00" }, { ...createInput, dueAt: "invalid" },
      { ...createInput, body: "x".repeat(501) }, { ...createInput, body: " " },
      { ...createInput, managerId: staff?.id }, { ...createInput, dueAt: "2200-01-01T00:00:00Z" },
    ]) expect(reminderCreateSchema.safeParse(input).success).toBe(false);
    expect(reminderUpdateSchema.safeParse({ action: "complete", revision: -1 }).success).toBe(false);
    expect(reminderUpdateSchema.safeParse({ action: "complete" }).success).toBe(false);
  });
});
