import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { listLeads } from "@/server/services/admin";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { updateSettings } from "@/server/settings";
import { defaultSettings } from "@/config/settings";
import { newSession, PNG, setupTestEnv } from "./helpers";
import { randomUUID } from "node:crypto";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => { await env.db.delete(schema.visitorSessions); await updateSettings({ ...defaultSettings, autoMessageEnabled: false }); });
afterAll(async () => { await env.client.close(); });

async function candidate(name: string, inactive: number, answered = 0, submitted = false, status: typeof schema.leads.$inferSelect.status = "new") {
  const sessionId = await newSession(env.db);
  await saveContact(sessionId, { name, phone: "600123456" });
  for (const key of ["q1", "q2", "q3"].slice(0, answered)) await saveAnswer(sessionId, key, "yes");
  if (submitted) {
    const file = await uploadFile({ sessionId, purpose: "submission", uploadedBy: "visitor", file: { name: "test.png", type: "image/png", buffer: PNG } });
    await submitTask(sessionId, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Opis poprawnie wykonanego zadania." });
  }
  await env.db.update(schema.visitorSessions).set({ lastSeenAt: new Date(Date.now() - inactive * 60_000) }).where(eq(schema.visitorSessions.id, sessionId));
  const [lead] = await env.db.update(schema.leads).set({ status }).where(eq(schema.leads.sessionId, sessionId)).returning();
  return { id: lead.id, sessionId };
}

it("defaults to inactive unfinished leads, excludes decided/submitted leads and orders by longest inactivity", async () => {
  const active = await candidate("Aktywny", 1);
  const questions = await candidate("Pytania", 120, 1);
  const task = await candidate("Zadanie", 70, 3);
  await candidate("Gotowy", 300, 3, true);
  await candidate("Zakończony", 400, 0, false, "completed");
  await candidate("Odrzucony", 500, 0, false, "rejected");
  const result = await listLeads({ queue: "unfinished" });
  expect(result.items.map(row => row.id)).toEqual([questions.id, task.id]);
  expect(result.total).toBe(2); expect(result.unfinishedCount).toBe(2);
  expect(result.items.map(row => row.stage)).toEqual(["questions", "task"]);
  expect(result.items.every(row => !row.isActive && typeof row.lastSeenAt === "string")).toBe(true);
  const all = await listLeads({});
  expect(all.total).toBe(6);
  expect(all.items.find(row => row.id === active.id)?.isActive).toBe(true);
});

it("combines stage, inactivity, search and status without treating missing answers as a submission", async () => {
  const active = await candidate("Jan Aktywny", 1);
  const questions = await candidate("Jan Pytania", 80, 2, false, "in_progress");
  const task = await candidate("Jan Zadanie", 40, 3);
  expect((await listLeads({ queue: "unfinished", stage: "questions" })).items.map(row => row.id)).toEqual([questions.id]);
  expect((await listLeads({ queue: "unfinished", stage: "task" })).items.map(row => row.id)).toEqual([task.id]);
  expect((await listLeads({ queue: "unfinished", inactiveMinutes: "0", stage: "questions" })).items.map(row => row.id)).toEqual([questions.id, active.id]);
  expect((await listLeads({ queue: "unfinished", inactiveMinutes: "120" })).total).toBe(0);
  expect((await listLeads({ queue: "unfinished", q: "Pytania", status: "in_progress" })).items.map(row => row.id)).toEqual([questions.id]);
  expect((await listLeads({ queue: "unfinished", stage: "submitted" })).total).toBe(0);
});

it("removes a resumed lead from the inactive queue and validates filter bounds", async () => {
  const lead = await candidate("Powracający", 90, 3);
  expect((await listLeads({ queue: "unfinished" })).total).toBe(1);
  await env.db.update(schema.visitorSessions).set({ lastSeenAt: new Date() }).where(eq(schema.visitorSessions.id, lead.sessionId));
  expect((await listLeads({ queue: "unfinished" })).total).toBe(0);
  expect((await listLeads({ queue: "unfinished", inactiveMinutes: "0" })).items[0].isActive).toBe(true);
  for (const filter of [{ stage: "invented" }, { inactiveMinutes: "-1" }, { inactiveMinutes: "10081" }]) await expect(listLeads(filter)).rejects.toBeDefined();
});
