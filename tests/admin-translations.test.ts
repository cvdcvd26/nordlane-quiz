import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema } from "@/db";
import { newSession, setupTestEnv } from "./helpers";
import { saveContact } from "@/server/services/contact";
import { ensureConversation } from "@/server/services/leads";
import { getVisitorChat } from "@/server/services/chat";
import { saveAnswer } from "@/server/services/quiz";
import { translateDraft, translateIncoming, translationStatus } from "@/server/services/translations";
import { protectTranslationRuns, setTranslationProvider, translateProtectedRuns, type TranslationProviderInput } from "@/server/translation-provider";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let calls: TranslationProviderInput[];
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  vi.stubEnv("OPENAI_API_KEY", "sk-dummy-translation-tests-never-used-for-network");
  vi.stubEnv("OPENAI_TRANSLATION_ENABLED", "true");
  vi.stubEnv("OPENAI_TRANSLATION_BUDGET_USD", "5");
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.translationUsage);
  calls = [];
  setTranslationProvider(async input => {
    calls.push(input);
    return { runs: input.runs.map(text => `${input.target === "pl" ? "Polski: " : "Русский: "}${text}`), inputTokens: 100, outputTokens: 100 };
  });
});
afterAll(async () => { setTranslationProvider(null); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await env.client.close(); });

async function candidate(body = "Dzień dobry, mam pytanie.") {
  const sid = await newSession(env.db);
  await saveContact(sid, { name: "Private candidate", phone: "600123456" });
  for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
  const conversation = await ensureConversation(env.db, sid);
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
  const [message] = await env.db.insert(schema.messages).values({ conversationId: conversation.id, sender: "visitor", body, clientMessageId: randomUUID() }).returning();
  return { sid, lead, conversation, message };
}

describe("private administrator translations", () => {
  it("fails closed until explicitly configured and reports no key or other account details", async () => {
    const { lead } = await candidate();
    vi.stubEnv("OPENAI_TRANSLATION_ENABLED", "false");
    expect(await translationStatus()).toEqual({ enabled: false, reason: "not_configured", usedUsd: 0, limitUsd: 5 });
    await expect(translateDraft(lead.id, "Здравствуйте")).rejects.toMatchObject({ code: "translation_not_configured" });
    vi.stubEnv("OPENAI_TRANSLATION_ENABLED", "true"); vi.stubEnv("OPENAI_API_KEY", "");
    await expect(translateDraft(lead.id, "Здравствуйте")).rejects.toMatchObject({ code: "translation_not_configured" });
    expect(calls).toHaveLength(0);
    vi.stubEnv("OPENAI_API_KEY", "dummy"); vi.stubEnv("OPENAI_TRANSLATION_BUDGET_USD", "46");
    expect((await translationStatus()).reason).toBe("not_configured");
  });

  it("translates a visitor message once, returns its source hash and reuses the private cache", async () => {
    const { lead, message, sid } = await candidate();
    const first = await translateIncoming(lead.id, [message.id, message.id]);
    expect(first.failures).toEqual([]);
    expect(first.translations).toEqual([{ messageId: message.id, sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), body: "Русский: Dzień dobry, mam pytanie." }]);
    expect(await translateIncoming(lead.id, [message.id])).toEqual(first);
    expect(calls).toHaveLength(1);
    expect((await translationStatus()).usedUsd).toBe(0.00006);
    const visitor = await getVisitorChat(sid);
    expect(JSON.stringify(visitor)).not.toContain("Русский:");
    expect(visitor.messages[0].body).toBe(message.body);
  });

  it("never returns another lead's, admin, system, deleted or unknown messages", async () => {
    const a = await candidate(); const b = await candidate("Tajne dane innego kandydata");
    const [admin] = await env.db.insert(schema.messages).values({ conversationId: a.conversation.id, sender: "admin", body: "Admin message", clientMessageId: randomUUID() }).returning();
    const [system] = await env.db.insert(schema.messages).values({ conversationId: a.conversation.id, sender: "system", body: "System message", clientMessageId: randomUUID() }).returning();
    await env.db.update(schema.messages).set({ deletedAt: new Date() }).where(eq(schema.messages.id, a.message.id));
    const ids = [a.message.id, b.message.id, admin.id, system.id, randomUUID()];
    const result = await translateIncoming(a.lead.id, ids);
    expect(result.translations).toEqual([]);
    expect(result.failures).toHaveLength(ids.length);
    expect(result.failures.every(value => value.code === "message_unavailable")).toBe(true);
    expect(calls).toHaveLength(0);
    await expect(translateDraft(999999, "Здравствуйте")).rejects.toMatchObject({ status: 404 });
  });

  it("invalidates an edited message and excludes a cached message after deletion", async () => {
    const { lead, message } = await candidate();
    const first = await translateIncoming(lead.id, [message.id]);
    await env.db.update(schema.messages).set({ body: "Nowa wiadomość", changeRevision: 1 }).where(eq(schema.messages.id, message.id));
    const second = await translateIncoming(lead.id, [message.id]);
    expect(second.translations[0].sourceHash).not.toBe(first.translations[0].sourceHash);
    expect(second.translations[0].body).toContain("Nowa wiadomość");
    expect(calls).toHaveLength(2);
    await env.db.update(schema.messages).set({ deletedAt: new Date() }).where(eq(schema.messages.id, message.id));
    expect((await translateIncoming(lead.id, [message.id])).translations).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("checks edits and deletions again when they race an external translation", async () => {
    const { lead, message } = await candidate();
    setTranslationProvider(async input => {
      await env.db.update(schema.messages).set({ deletedAt: new Date() }).where(eq(schema.messages.id, message.id));
      return { runs: input.runs, inputTokens: 100, outputTokens: 100 };
    });
    expect((await translateIncoming(lead.id, [message.id])).failures).toEqual([{ messageId: message.id, code: "message_unavailable" }]);
  });

  it("allows a formatted incoming paragraph to expand beyond outgoing rich-run limits", async () => {
    const original = "W".repeat(3500);
    const translated = "Я".repeat(4500);
    const { lead, message } = await candidate(original);
    await env.db.update(schema.messages).set({
      bodyRich: { version: 1, runs: [{ text: original, bold: true }] },
    }).where(eq(schema.messages.id, message.id));
    setTranslationProvider(async input => {
      calls.push(input);
      return { runs: [translated], inputTokens: 1000, outputTokens: 1500 };
    });

    const result = await translateIncoming(lead.id, [message.id]);
    expect(result.failures).toEqual([]);
    expect(result.translations).toEqual([{ messageId: message.id, sourceHash: expect.any(String), body: translated }]);
    expect(await translateIncoming(lead.id, [message.id])).toEqual(result);
    expect(calls).toHaveLength(1);
    const [cached] = await env.db.select().from(schema.messageTranslations).where(eq(schema.messageTranslations.messageId, message.id));
    expect(cached).toMatchObject({ body: translated, bodyRich: null, status: "ready" });
  });

  it("preserves rich marks and exact links while masking contacts and identifiers from the provider", async () => {
    const { lead } = await candidate();
    const bodyRich = { version: 1 as const, runs: [
      { text: "Здравствуйте", bold: true as const, href: "https://private.example/link" },
      { text: ", 600123456 user@example.com https://signal.me/#eu/test 01234567890", underline: true as const },
    ] };
    const result = await translateDraft(lead.id, bodyRich.runs.map(run => run.text).join(""), bodyRich);
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0]);
    for (const secret of ["600123456", "user@example.com", "https://signal.me/", "01234567890", "private.example"]) expect(sent).not.toContain(secret);
    expect(result.body).toContain("600123456 user@example.com https://signal.me/#eu/test 01234567890");
    expect(result.bodyRich?.runs[0]).toMatchObject({ bold: true, href: "https://private.example/link" });
    expect(result.bodyRich?.runs[1]).toMatchObject({ underline: true });
    expect(result.bodyRich?.runs.map(run => run.text).join("")).toBe(result.body);
  });

  it("leaves Polish templates and attachment-only drafts unchanged without charging", async () => {
    const { lead } = await candidate();
    expect(await translateDraft(lead.id, "Dziękujemy! Wkrótce odpowiemy.")).toEqual({ body: "Dziękujemy! Wkrótce odpowiemy.", bodyRich: null });
    expect(await translateDraft(lead.id, "")).toEqual({ body: "", bodyRich: null });
    expect(calls).toHaveLength(0);
    expect((await translationStatus()).usedUsd).toBe(0);
  });

  it("returns successful cached drafts without paying twice", async () => {
    const { lead } = await candidate();
    const a = await translateDraft(lead.id, "Здравствуйте");
    expect(await translateDraft(lead.id, "Здравствуйте")).toEqual(a);
    expect(calls).toHaveLength(1);
  });

  it("reserves the worst-case cost atomically before network work and rejects duplicate in-flight translations", async () => {
    const { lead } = await candidate();
    vi.stubEnv("OPENAI_TRANSLATION_BUDGET_USD", "0.02");
    let finish!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    setTranslationProvider(async input => { started(); await waiting; return { runs: input.runs, inputTokens: 100, outputTokens: 100 }; });
    const first = translateDraft(lead.id, "Здравствуйте");
    await ready;
    expect(await translationStatus()).toMatchObject({ enabled: false, reason: "limit_reached", usedUsd: 0.02 });
    await expect(translateDraft(lead.id, "Здравствуйте")).rejects.toMatchObject({ code: "translation_busy" });
    await expect(translateDraft(lead.id, "Другой текст")).rejects.toMatchObject({ code: "translation_limit_reached" });
    finish(); await first;
    expect((await translationStatus()).usedUsd).toBe(0.00006);
  });

  it("keeps timeout/malformed-response reservations charged and never returns an untranslated Russian draft", async () => {
    const { lead } = await candidate();
    setTranslationProvider(async () => { throw new Error("secret remote debug content that must not escape"); });
    await expect(translateDraft(lead.id, "Здравствуйте")).rejects.toMatchObject({ code: "translation_unavailable", message: expect.not.stringContaining("secret") });
    expect((await translationStatus()).usedUsd).toBe(0.02);
    setTranslationProvider(async () => ({ runs: ["lost identifier"], inputTokens: 100, outputTokens: 100 }));
    await expect(translateDraft(lead.id, "Мой телефон 600123456")).rejects.toMatchObject({ code: "translation_invalid_response" });
    expect((await translationStatus()).usedUsd).toBe(0.04);
  });

  it("bounds batch concurrency to three and returns errors individually", async () => {
    const { lead, conversation } = await candidate();
    const rows = await env.db.insert(schema.messages).values(Array.from({ length: 5 }, (_, n) => ({ conversationId: conversation.id, sender: "visitor" as const, body: `Pytanie ${n}`, clientMessageId: randomUUID() }))).returning();
    let active = 0; let maximum = 0;
    setTranslationProvider(async input => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return { runs: input.runs, inputTokens: 100, outputTokens: 100 };
    });
    const result = await translateIncoming(lead.id, rows.map(row => row.id));
    expect(result.translations).toHaveLength(5);
    expect(result.failures).toEqual([]);
    expect(maximum).toBeLessThanOrEqual(3);
  });
});

describe("provider privacy and response verification", () => {
  it("protects URLs, emails and numeric identifiers split across formatting runs", async () => {
    const input = ["Здравствуйте, https://signal.me/#eu/", "PRIVATE-SIGNAL-TOKEN", " user@", "private.example", " 01234", "567890"];
    const protectedRuns = protectTranslationRuns(input);
    const sent = JSON.stringify(protectedRuns.masked);
    for (const secret of ["https://", "signal.me", "PRIVATE-SIGNAL-TOKEN", "user@", "private.example", "01234", "567890"]) expect(sent).not.toContain(secret);
    expect(protectedRuns.restore(protectedRuns.masked)).toEqual(input);
    await translateProtectedRuns({ target: "pl", runs: input });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).not.toContain("PRIVATE-SIGNAL-TOKEN");
  });

  it("does not make a paid request for a URL or identifier-only message", async () => {
    expect(await translateProtectedRuns({ target: "ru", runs: ["https://private.example/abc", " 600123456"] }))
      .toEqual({ runs: ["https://private.example/abc", " 600123456"], inputTokens: 0, outputTokens: 0 });
    expect(calls).toHaveLength(0);
  });

  it("rejects missing, duplicated, or cross-run protected identifiers", () => {
    const p = protectTranslationRuns(["Telefon 600123456", "Email user@example.com"]);
    expect(() => p.restore(["No token", p.masked[1]])).toThrow();
    expect(() => p.restore([p.masked[0] + p.masked[0], p.masked[1]])).toThrow();
    expect(() => p.restore([p.masked[1], p.masked[0]])).toThrow();
    expect(p.restore(p.masked)).toEqual(["Telefon 600123456", "Email user@example.com"]);
  });

  it("uses only the fixed model, store:false, bounded output and no tools or credentials in the payload", async () => {
    setTranslationProvider(null);
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body));
      const messages = requestBody.messages as { content: string }[];
      const input = JSON.parse(messages[1].content);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ runs: input.runs }) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
    }));
    const result = await translateProtectedRuns({ target: "pl", runs: ["Телефон 600123456 https://private.example"] });
    expect(result.runs[0]).toBe("Телефон 600123456 https://private.example");
    expect(requestBody).toMatchObject({ model: "gpt-6-luna", store: false, reasoning_effort: "none", max_completion_tokens: 6000 });
    expect(requestBody).not.toHaveProperty("tools");
    expect(requestBody).not.toHaveProperty("background");
    const payload = JSON.stringify(requestBody);
    expect(payload).not.toContain("600123456"); expect(payload).not.toContain("private.example"); expect(payload).not.toContain("sk-dummy");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("sanitises provider error bodies and performs no automatic retry", async () => {
    setTranslationProvider(null);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("PRIVATE PROVIDER BODY", { status: 429 })));
    await expect(translateProtectedRuns({ target: "pl", runs: ["Здравствуйте"] })).rejects.toMatchObject({ code: "translation_unavailable", message: expect.not.stringContaining("PRIVATE") });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
