import "server-only";
import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";

const DAY_MS = 86_400_000;
// Brevo keeps an idempotency key for 30 minutes. Never retry an ambiguous
// request after that boundary: it could otherwise produce a second email.
const SAFE_RETRY_MS = 25 * 60_000;
export type CandidateEmailKind = "otp" | "welcome" | "chat";

export class CandidateEmailError extends Error {
  constructor(public readonly code: "disabled" | "quota" | "temporary" | "rejected" | "uncertain") {
    super(`candidate_email_${code}`);
  }
}

export function candidateEmailConfigured() {
  if (process.env.CANDIDATE_EMAIL_ENABLED !== "true" || !process.env.BREVO_API_KEY?.trim() ||
      !z.email().safeParse(process.env.BREVO_SENDER_EMAIL).success ||
      (process.env.CANDIDATE_EMAIL_SECRET?.length ?? 0) < 32) return false;
  try {
    const url = new URL(process.env.APP_URL ?? "");
    return url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function candidateSiteUrl() {
  if (!candidateEmailConfigured()) throw new CandidateEmailError("disabled");
  return new URL(process.env.APP_URL!).origin;
}

const positiveLimit = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};

/** A conservative rolling 24h cap also leaves room for login codes. */
async function reserveSend(id: string, kind: CandidateEmailKind, now: Date) {
  return db().transaction(async tx => {
    await tx.select().from(schema.candidateEmailBudgetLock)
      .where(eq(schema.candidateEmailBudgetLock.key, "global")).for("update");
    const [existing] = await tx.select().from(schema.candidateEmailSends).where(eq(schema.candidateEmailSends.id, id));
    if (existing) {
      if (existing.kind !== kind || existing.status === "rejected") throw new CandidateEmailError("rejected");
      if (existing.status === "accepted") return existing;
      if (now.getTime() - existing.createdAt.getTime() >= SAFE_RETRY_MS) throw new CandidateEmailError("uncertain");
      return existing;
    }
    const totalLimit = positiveLimit(process.env.BREVO_DAILY_LIMIT, 300);
    const reservedOtp = Math.min(positiveLimit(process.env.BREVO_OTP_RESERVE, 60), totalLimit);
    const [usage] = await tx.select({ count: count() }).from(schema.candidateEmailSends)
      .where(gte(schema.candidateEmailSends.createdAt, new Date(now.getTime() - DAY_MS)));
    const limit = kind === "otp" ? totalLimit : totalLimit - reservedOtp;
    if (usage.count >= limit) throw new CandidateEmailError("quota");
    const [reserved] = await tx.insert(schema.candidateEmailSends).values({ id, kind, createdAt: now }).returning();
    return reserved;
  });
}

export type CandidateEmailTransport = (payload: {
  email: string; subject: string; text: string; id: string;
}) => Promise<string>;
let override: CandidateEmailTransport | null = null;
/** Test hook; transport is the only network boundary. */
export const setCandidateEmailTransport = (transport: CandidateEmailTransport | null) => { override = transport; };

async function brevoTransport(p: { email: string; subject: string; text: string; id: string }) {
  let response: Response;
  try {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { "api-key": process.env.BREVO_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "AlleyBiz", email: process.env.BREVO_SENDER_EMAIL },
        to: [{ email: p.email, contactPixelTrackingConsent: false }],
        subject: p.subject,
        // Plain-text only: no embedded images, tracking pixels, chat excerpts,
        // candidate names, documents or one-click authentication links.
        textContent: p.text,
        headers: { idempotencyKey: p.id },
      }),
    });
  } catch { throw new CandidateEmailError("temporary"); }
  // Do not propagate/log Brevo's response text: it can contain recipient data.
  const payload = await response.json().catch(() => null) as { messageId?: unknown; code?: unknown } | null;
  if (!response.ok) {
    if (response.status === 400 && payload?.code === "duplicate_parameter") return "deduplicated";
    throw new CandidateEmailError(response.status === 429 || response.status >= 500 ? "temporary" : "rejected");
  }
  if (typeof payload?.messageId !== "string") throw new CandidateEmailError("temporary");
  return payload.messageId;
}

export async function sendCandidateEmail(kind: CandidateEmailKind, email: string, subject: string, text: string, id: string, now = new Date()) {
  if (!candidateEmailConfigured()) throw new CandidateEmailError("disabled");
  const reservation = await reserveSend(id, kind, now);
  if (reservation.status === "accepted") return reservation.providerId ?? "accepted";
  try {
    const providerId = await (override ?? brevoTransport)({ email, subject, text, id });
    await db().update(schema.candidateEmailSends).set({ status: "accepted", providerId })
      .where(eq(schema.candidateEmailSends.id, id));
    return providerId;
  } catch (error) {
    if (error instanceof CandidateEmailError && error.code === "rejected") {
      await db().update(schema.candidateEmailSends).set({ status: "rejected" })
        .where(and(eq(schema.candidateEmailSends.id, id), eq(schema.candidateEmailSends.status, "reserved")));
    }
    throw error instanceof CandidateEmailError ? error : new CandidateEmailError("temporary");
  }
}

export async function sendCandidateCode(email: string, code: string, challengeId: string) {
  if (!/^\d{6}$/.test(code)) throw new CandidateEmailError("rejected");
  await sendCandidateEmail("otp", email, "AlleyBiz — Twój kod logowania",
    `Twój jednorazowy kod do AlleyBiz: ${code}\n\nKod jest ważny przez 10 minut. Wpisz go w otwartej stronie ${candidateSiteUrl()}. Nie udostępniaj go innym osobom.\n\nJeśli nie proszono o ten kod, zignoruj tę wiadomość.`,
    `otp-${challengeId}`);
}
