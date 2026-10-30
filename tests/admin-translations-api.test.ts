import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { GET } from "@/app/api/admin/translation/route";
import { POST } from "@/app/api/admin/leads/[id]/translations/route";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { setTranslationProvider } from "@/server/translation-provider";
import { newSession, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
}) }));
const secret = "admin-translation-api-test-secret-32-characters";
let env: Awaited<ReturnType<typeof setupTestEnv>>;
let calls = 0;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  vi.stubEnv("OPENAI_API_KEY", "test-key-never-sent-over-network");
  vi.stubEnv("OPENAI_TRANSLATION_ENABLED", "true");
  vi.stubEnv("OPENAI_TRANSLATION_BUDGET_USD", "5");
  jar.clear(); calls = 0;
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.translationUsage);
  setTranslationProvider(async ({ target, runs }) => {
    calls++;
    return { runs: runs.map(run => target === "ru"
      ? run.replaceAll("Dzień dobry", "Добрый день")
      : run.replaceAll("Здравствуйте", "Dzień dobry")), inputTokens: 100, outputTokens: 100 };
  });
});
afterAll(async () => { setTranslationProvider(null); vi.unstubAllEnvs(); await env.client.close(); });

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (id: number, value: unknown, origin = "https://example.com") => new Request(`https://example.com/api/admin/leads/${id}/translations`, {
  method: "POST", headers: { host: "example.com", origin, "content-type": "application/json" }, body: JSON.stringify(value),
});
async function login(temporary = false) {
  const [admin] = await env.db.insert(schema.adminUsers).values({ email: `${randomUUID()}@example.com`, passwordHash: "unused", isTemporary: temporary }).returning();
  jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
}
async function candidate() {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Translation test", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  const result = await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Dzień dobry, mam pytanie." });
  return { sid, lead, message: result.message };
}

it("requires admin authentication and rejects cross-site or malformed translation writes before any provider call", async () => {
  const { lead, message } = await candidate();
  const incoming = { kind: "incoming", messageIds: [message.id] };
  expect((await GET()).status).toBe(401);
  expect((await POST(request(lead.id, incoming), ctx(lead.id))).status).toBe(401);
  await login();
  expect((await POST(request(lead.id, incoming, "https://attacker.example"), ctx(lead.id))).status).toBe(403);
  expect((await POST(request(lead.id, { kind: "incoming", messageIds: ["not-a-uuid"] }), ctx(lead.id))).status).toBe(400);
  expect((await POST(request(lead.id, { kind: "draft", body: "a".repeat(4001) }), ctx(lead.id))).status).toBe(400);
  expect(calls).toBe(0);
});

it("lets both admin types read translations while candidate chat retains only the original", async () => {
  const { sid, lead, message } = await candidate();
  for (const temporary of [false, true]) {
    await login(temporary);
    expect((await GET()).status).toBe(200);
    const response = await POST(request(lead.id, { kind: "incoming", messageIds: [message.id] }), ctx(lead.id));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.translations[0]).toMatchObject({ messageId: message.id, body: "Добрый день, mam pytanie." });
    expect(data.failures).toEqual([]);
  }
  expect(calls).toBe(1);
  const visible = await getVisitorChat(sid);
  expect(visible.messages[0].body).toBe("Dzień dobry, mam pytanie.");
  expect(JSON.stringify(visible)).not.toContain("Добрый день");
});

it("does not return another lead's message or translate it through a forged ID list", async () => {
  const first = await candidate();
  const second = await candidate();
  await login();
  const response = await POST(request(first.lead.id, { kind: "incoming", messageIds: [second.message.id, randomUUID()] }), ctx(first.lead.id));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.translations).toEqual([]);
  expect(data.failures).toHaveLength(2);
  expect(calls).toBe(0);
});

it("previews formatted outgoing text without posting a message or exposing a credential", async () => {
  const { sid, lead } = await candidate();
  await login();
  const response = await POST(request(lead.id, { kind: "draft", body: "Здравствуйте", bodyRich: { version: 1, runs: [{ text: "Здравствуйте", bold: true }] } }), ctx(lead.id));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ body: "Dzień dobry", bodyRich: { version: 1, runs: [{ text: "Dzień dobry", bold: true }] } });
  expect((await getVisitorChat(sid)).messages).toHaveLength(1);
  const status = JSON.stringify(await (await GET()).json());
  expect(status).not.toContain("test-key");
  expect(status).not.toContain("Здравствуйте");
});

it("fails closed when translation is disabled without silently sending a Russian draft", async () => {
  const { sid, lead } = await candidate();
  await login();
  vi.stubEnv("OPENAI_TRANSLATION_ENABLED", "false");
  expect(await (await GET()).json()).toMatchObject({ enabled: false, reason: "not_configured" });
  const response = await POST(request(lead.id, { kind: "draft", body: "Здравствуйте" }), ctx(lead.id));
  expect(response.status).toBe(503);
  expect(calls).toBe(0);
  expect((await getVisitorChat(sid)).messages).toHaveLength(1);
});

it("serves an already paid translation at the cap and never starts work for a cache-only miss", async () => {
  const { sid, lead, message } = await candidate();
  await login();
  expect((await POST(request(lead.id, { kind: "incoming", messageIds: [message.id] }), ctx(lead.id))).status).toBe(200);
  expect(calls).toBe(1);
  await env.db.insert(schema.translationUsage).values({ month: new Date().toISOString().slice(0, 7), reservedMicros: 5_000_000 });
  expect(await (await GET()).json()).toMatchObject({ enabled: false, reason: "limit_reached" });
  const next = await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Dzień dobry, kolejne pytanie." });
  const cached = await POST(request(lead.id, { kind: "incoming", messageIds: [message.id, next.message.id], cacheOnly: true }), ctx(lead.id));
  const value = await cached.json();
  expect(value.translations).toHaveLength(1);
  expect(value.translations[0].messageId).toBe(message.id);
  expect(value.failures).toEqual([{ messageId: next.message.id, code: "translation_limit_reached" }]);
  expect(calls).toBe(1);
  await env.db.delete(schema.translationUsage);
  await POST(request(lead.id, { kind: "incoming", messageIds: [next.message.id], cacheOnly: true }), ctx(lead.id));
  expect(calls).toBe(1);
});
