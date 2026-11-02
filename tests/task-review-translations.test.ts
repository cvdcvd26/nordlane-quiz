import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { POST } from "@/app/api/admin/leads/[id]/translations/route";
import { saveContact } from "@/server/services/contact";
import { getVisitorState, saveAnswer } from "@/server/services/quiz";
import { getVisitorChat } from "@/server/services/chat";
import { getLeadRevisions, requestTaskRevision, submitTaskRevision } from "@/server/services/task-revisions";
import { translateDraft, translateIncoming, translateTaskReview } from "@/server/services/translations";
import { setTranslationProvider } from "@/server/translation-provider";
import { newSession, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));
const secret = "task-review-translation-test-secret-at-least-32-characters";
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let calls: { runs: string[]; target: string }[] = [];
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  vi.stubEnv("OPENAI_API_KEY", "test-key-no-external-requests");
  vi.stubEnv("OPENAI_TRANSLATION_ENABLED", "true");
  vi.stubEnv("OPENAI_TRANSLATION_BUDGET_USD", "5");
  jar.clear(); calls = [];
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.translationUsage);
  await env.db.delete(schema.rateLimits);
  setTranslationProvider(async ({ target, runs }) => {
    calls.push({ target, runs });
    return { runs: runs.map(run => run.replaceAll("Dzień dobry", "Добрый день")), inputTokens: 100, outputTokens: 100 };
  });
});
afterAll(async () => { setTranslationProvider(null); vi.unstubAllEnvs(); await env.client.close(); });

async function candidate(review: string | null = "Dzień dobry, zadanie gotowe.") {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Task translation test", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  const [submission] = await env.db.insert(schema.taskSubmissions).values({ sessionId: sid, idempotencyKey: randomUUID(), review }).returning();
  return { sid, lead, submission };
}
async function login(temporary = false) {
  const [admin] = await env.db.insert(schema.adminUsers).values({ email: `${randomUUID()}@example.test`, passwordHash: "unused", isTemporary: temporary }).returning();
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
  return admin;
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (leadId: number, value: unknown, origin = "https://example.com") => new Request(`https://example.com/api/admin/leads/${leadId}/translations`, {
  method: "POST", headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify(value),
});

it("translates the saved task answer for either admin, caches it and never changes candidate content", async () => {
  const { sid, lead, submission } = await candidate();
  const before = await getVisitorState(sid);
  for (const temporary of [false, true]) {
    await login(temporary);
    const response = await POST(request(lead.id, { kind: "task_review", submissionId: submission.id }), ctx(lead.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ body: "Добрый день, zadanie gotowe.", sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  }
  expect(calls).toHaveLength(1);
  expect(await getVisitorState(sid)).toEqual(before);
  expect((await getVisitorChat(sid)).messages).toEqual([]);
  expect((await env.db.select().from(schema.taskSubmissions))[0].review).toBe(submission.review);
  expect((await env.db.select().from(schema.messageTranslations))[0]).toMatchObject({ leadId: lead.id, messageId: null, target: "ru", status: "ready" });
});

it("requires admin, same origin and an owned source ID; refuses browser-supplied text", async () => {
  const first = await candidate();
  const second = await candidate();
  const input = { kind: "task_review", submissionId: first.submission.id };
  expect((await POST(request(first.lead.id, input), ctx(first.lead.id))).status).toBe(401);
  await login();
  expect((await POST(request(first.lead.id, input, "https://attacker.example"), ctx(first.lead.id))).status).toBe(403);
  expect((await POST(request(first.lead.id, { ...input, body: "Forged content" }), ctx(first.lead.id))).status).toBe(400);
  expect((await POST(request(first.lead.id, { ...input, submissionId: "not-a-uuid" }), ctx(first.lead.id))).status).toBe(400);
  for (const submissionId of [second.submission.id, randomUUID()]) {
    const response = await POST(request(first.lead.id, { ...input, submissionId }), ctx(first.lead.id));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("task_review_unavailable");
  }
  expect(calls).toHaveLength(0);
});

it("honours the shared switch and cap, but can return paid translations without new charges", async () => {
  const first = await candidate();
  const other = await candidate("Dzień dobry, inna odpowiedź.");
  const translated = await translateTaskReview(first.lead.id, first.submission.id);
  await env.db.insert(schema.translationUsage).values({ month: new Date().toISOString().slice(0, 7), reservedMicros: 5_000_000 });
  expect(await translateTaskReview(first.lead.id, first.submission.id, { cacheOnly: true })).toEqual(translated);
  await expect(translateTaskReview(other.lead.id, other.submission.id)).rejects.toMatchObject({ code: "translation_limit_reached" });
  await env.db.delete(schema.translationUsage);
  await expect(translateTaskReview(other.lead.id, other.submission.id, { cacheOnly: true })).rejects.toMatchObject({ code: "translation_limit_reached" });
  vi.stubEnv("OPENAI_TRANSLATION_ENABLED", "false");
  await expect(translateTaskReview(first.lead.id, first.submission.id)).rejects.toMatchObject({ code: "translation_not_configured" });
  expect(calls).toHaveLength(1);
});

it("does not translate empty answers or already Russian text and masks contacts, IDs and URLs", async () => {
  const empty = await candidate(null);
  await expect(translateTaskReview(empty.lead.id, empty.submission.id)).rejects.toMatchObject({ code: "task_review_unavailable" });
  const russian = await candidate("Всё готово, ошибок нет.");
  expect((await translateTaskReview(russian.lead.id, russian.submission.id)).body).toBe(russian.submission.review);
  expect(calls).toHaveLength(0);
  const privateReview = "Dzień dobry, test@example.test +48 600 123 456 12345678901 https://example.com/private";
  const person = await candidate(privateReview);
  expect((await translateTaskReview(person.lead.id, person.submission.id)).body).toBe(privateReview.replace("Dzień dobry", "Добрый день"));
  expect(calls).toHaveLength(1);
  const providerInput = JSON.stringify(calls[0]);
  for (const sensitive of ["test@example.test", "600", "12345678901", "https://example.com/private", "Task translation test"]) expect(providerInput).not.toContain(sensitive);
});

it("uses a source namespace and hash so edits, different submissions and chat drafts cannot reuse the wrong translation", async () => {
  const first = await candidate();
  const second = await candidate();
  const original = await translateTaskReview(first.lead.id, first.submission.id);
  await translateTaskReview(second.lead.id, second.submission.id);
  await translateDraft(first.lead.id, "Добрый день");
  await env.db.update(schema.taskSubmissions).set({ review: "Dzień dobry, poprawione zadanie." }).where(eq(schema.taskSubmissions.id, first.submission.id));
  const changed = await translateTaskReview(first.lead.id, first.submission.id);
  expect(changed.body).toBe("Добрый день, poprawione zadanie.");
  expect(changed.sourceHash).not.toBe(original.sourceHash);
  expect(calls).toHaveLength(4);
  expect(await translateTaskReview(first.lead.id, first.submission.id)).toEqual(changed);
  expect(calls).toHaveLength(4);
});

it.each(["change", "delete"])("suppresses an in-flight translation when its task answer is %sd", async action => {
  const { lead, submission } = await candidate();
  setTranslationProvider(async ({ runs }) => {
    if (action === "delete") await env.db.delete(schema.taskSubmissions).where(eq(schema.taskSubmissions.id, submission.id));
    else await env.db.update(schema.taskSubmissions).set({ review: "Changed source" }).where(eq(schema.taskSubmissions.id, submission.id));
    return { runs: runs.map(() => "Устаревший перевод"), inputTokens: 10, outputTokens: 10 };
  });
  await expect(translateTaskReview(lead.id, submission.id)).rejects.toMatchObject({ code: "task_review_unavailable" });
});

it("exposes the revision response message ID only to admin history and reuses its existing chat translation", async () => {
  const { sid, lead } = await candidate();
  const admin = await login();
  const revision = await requestTaskRevision(lead.id, admin.id, { id: randomUUID(), instructions: "Popraw odpowiedź", sendMessage: false });
  await submitTaskRevision(sid, { revisionId: revision.id, body: "Dzień dobry, poprawione zadanie." });
  const history = await getLeadRevisions(lead.id);
  const response = history.revisions[0].response!;
  expect(response.id).toEqual(expect.any(String));
  const first = await translateIncoming(lead.id, [response.id]);
  const cached = await translateIncoming(lead.id, [response.id]);
  expect(first.translations[0]).toMatchObject({ messageId: response.id, body: "Добрый день, poprawione zadanie." });
  expect(cached).toEqual(first);
  expect(calls).toHaveLength(1);
  expect((await getVisitorChat(sid)).messages[0].body).toBe(response.body);
});
