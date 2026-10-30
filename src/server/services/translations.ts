import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db } from "@/db";
import { normalizeRichTextContent, plainTextDocument, type RichTextDocument } from "@/lib/rich-text";
import { AppError } from "../errors";
import { getLeadSessionId } from "./admin";
import {
  TRANSLATION_POLICY, TRANSLATION_RESERVATION_MICROS, translationConfiguration,
  translateProtectedRuns, translationCostMicros,
} from "../translation-provider";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type TextContent = { body: string; bodyRich: RichTextDocument | null };
export type TranslationStatus = {
  enabled: boolean;
  reason: "not_configured" | "limit_reached" | null;
  usedUsd: number;
  limitUsd: number;
};
const inputIds = z.array(z.string().uuid()).min(1).max(20);
const sourceHash = (content: TextContent) => createHash("sha256").update(JSON.stringify(content)).digest("hex");
const month = () => new Date().toISOString().slice(0, 7);
const unavailable = () => new AppError(503, "translation_unavailable", "Translation is temporarily unavailable. Your original text has been kept.");
const notConfigured = () => new AppError(503, "translation_not_configured", "The translator is not connected yet.");
const limitReached = () => new AppError(429, "translation_limit_reached", "The translation limit has been reached. Your original text has been kept.");
const safeError = (error: unknown) => error instanceof AppError ? error : unavailable();

async function usedMicros(client: Db | Tx, currentMonth: string) {
  const [value] = await client.select({ used: sql<number>`coalesce(sum(coalesce(${schema.translationUsage.actualMicros}, ${schema.translationUsage.reservedMicros})), 0)::int` })
    .from(schema.translationUsage).where(eq(schema.translationUsage.month, currentMonth));
  return Number(value?.used ?? 0);
}

export async function translationStatus(): Promise<TranslationStatus> {
  try {
    const config = translationConfiguration();
    const used = await usedMicros(db(), month());
    const reason = !config.configured ? "not_configured"
      : used + TRANSLATION_RESERVATION_MICROS > config.limitMicros ? "limit_reached" : null;
    return { enabled: reason === null, reason, usedUsd: used / 1_000_000, limitUsd: config.limitUsd };
  } catch (error) { throw safeError(error); }
}

function requireConfigured() {
  const config = translationConfiguration();
  if (!config.configured) throw notConfigured();
  return config;
}

/** The monthly lock serialises only reservations, never external network requests. */
async function claimTranslation(input: {
  key: string; leadId: number; messageId?: string; sourceHash: string; target: "pl" | "ru";
}) {
  const config = requireConfigured();
  const currentMonth = month();
  return db().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`alleybiz:translation:${currentMonth}`}))`);
    const [cached] = await tx.select().from(schema.messageTranslations)
      .where(eq(schema.messageTranslations.key, input.key));
    if (cached?.status === "ready" && cached.body !== null) return { cached: { body: cached.body, bodyRich: cached.bodyRich }, usageId: null };
    if (cached?.status === "pending" && Date.now() - cached.updatedAt.getTime() < 60_000) {
      throw new AppError(409, "translation_busy", "This translation is already being prepared.");
    }
    const spent = await usedMicros(tx, currentMonth);
    if (spent + TRANSLATION_RESERVATION_MICROS > config.limitMicros) throw limitReached();
    const [usage] = await tx.insert(schema.translationUsage).values({ month: currentMonth, reservedMicros: TRANSLATION_RESERVATION_MICROS }).returning();
    const row = {
      ...input, messageId: input.messageId ?? null, policy: TRANSLATION_POLICY,
      status: "pending", body: null, bodyRich: null, usageId: usage.id, updatedAt: new Date(),
    };
    await tx.insert(schema.messageTranslations).values(row).onConflictDoUpdate({
      target: schema.messageTranslations.key, set: row,
    });
    return { cached: null, usageId: usage.id };
  });
}

async function translatedContent(leadId: number, source: TextContent, target: "pl" | "ru", messageId?: string, cacheOnly = false): Promise<TextContent> {
  requireConfigured();
  // Already Polish templates and attachment-only messages do not incur a paid request.
  if (!source.body || (target === "pl" && !/\p{Script=Cyrillic}/u.test(source.body)) ||
    (target === "ru" && !/\p{Script=Latin}/u.test(source.body))) return source;
  const hash = sourceHash(source);
  const key = createHash("sha256").update(JSON.stringify([leadId, messageId ?? "draft", hash, target, TRANSLATION_POLICY])).digest("hex");
  if (cacheOnly) {
    // A budget-limited UI can still show translations already paid for. It must
    // never initiate a new provider request, even across a monthly reset.
    const [cached] = await db().select().from(schema.messageTranslations)
      .where(and(eq(schema.messageTranslations.key, key), eq(schema.messageTranslations.leadId, leadId),
        eq(schema.messageTranslations.status, "ready")));
    if (cached?.body !== null && cached?.body !== undefined) return { body: cached.body, bodyRich: cached.bodyRich };
    throw limitReached();
  }
  const claimed = await claimTranslation({ key, leadId, messageId, sourceHash: hash, target });
  if (claimed.cached) return claimed.cached;
  const usageId = claimed.usageId!;
  try {
    const document = source.bodyRich ?? plainTextDocument(source.body);
    const result = await translateProtectedRuns({ target, runs: document.runs.map(run => run.text) });
    const translatedDocument: RichTextDocument = {
      version: 1, runs: document.runs.map((run, index) => ({ ...run, text: result.runs[index] })),
    };
    // Incoming translations are displayed as plain text and may expand beyond
    // the outgoing editor's rich-run limits. Only Polish drafts retain marks.
    const translated = normalizeRichTextContent(result.runs.join(""), target === "pl" && source.bodyRich ? translatedDocument : null, target === "pl" ? 4000 : 12_000);
    const cost = translationCostMicros(result);
    // The fixed model/request/output bounds must fit the reserved maximum.
    if (cost > TRANSLATION_RESERVATION_MICROS) throw unavailable();
    await db().transaction(async tx => {
      await tx.update(schema.translationUsage).set({ actualMicros: cost }).where(eq(schema.translationUsage.id, usageId));
      await tx.update(schema.messageTranslations).set({
        status: "ready", ...translated, updatedAt: new Date(),
      }).where(and(eq(schema.messageTranslations.key, key), eq(schema.messageTranslations.usageId, usageId)));
    });
    return translated;
  } catch (error) {
    // A timeout or malformed answer may still have consumed provider tokens. Keep
    // its entire reservation charged locally; retrying cannot bypass the cap.
    await db().update(schema.messageTranslations).set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(schema.messageTranslations.key, key), eq(schema.messageTranslations.usageId, usageId)))
      .catch(() => undefined);
    throw safeError(error);
  }
}

export async function translateDraft(leadId: number, body: string, bodyRich?: unknown): Promise<TextContent> {
  try {
    await getLeadSessionId(leadId);
    const source = normalizeRichTextContent(body, bodyRich, 4000);
    return await translatedContent(leadId, source, "pl");
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw safeError(error);
  }
}

export async function translateIncoming(leadId: number, messageIds: string[], options: { cacheOnly?: boolean } = {}) {
  try {
    const ids = [...new Set(inputIds.parse(messageIds))];
    const sessionId = await getLeadSessionId(leadId);
    const rows = await db().select({ message: schema.messages }).from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(and(eq(schema.conversations.sessionId, sessionId), inArray(schema.messages.id, ids),
        eq(schema.messages.sender, "visitor"), isNull(schema.messages.deletedAt)));
    const byId = new Map(rows.map(row => [row.message.id, row.message]));
    const translations: { messageId: string; sourceHash: string; body: string }[] = [];
    const failures: { messageId: string; code: string }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        const message = byId.get(id);
        if (!message || !message.body.trim()) { failures.push({ messageId: id, code: "message_unavailable" }); continue; }
        try {
          const source = normalizeRichTextContent(message.body, message.bodyRich, 4000);
          const translated = await translatedContent(leadId, source, "ru", id, options.cacheOnly === true);
          // An edit or deletion that races the network request must not return the old text.
          const [current] = await db().select().from(schema.messages).where(and(eq(schema.messages.id, id),
            eq(schema.messages.conversationId, message.conversationId), isNull(schema.messages.deletedAt)));
          if (!current || sourceHash(normalizeRichTextContent(current.body, current.bodyRich, 4000)) !== sourceHash(source)) {
            failures.push({ messageId: id, code: "message_unavailable" }); continue;
          }
          translations.push({ messageId: id, sourceHash: sourceHash(source), body: translated.body });
        } catch (error) { failures.push({ messageId: id, code: safeError(error).code }); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    return { translations, failures };
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw safeError(error);
  }
}
