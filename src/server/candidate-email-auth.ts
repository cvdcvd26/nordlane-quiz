import "server-only";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db, schema } from "@/db";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";
import { lockVisitor } from "./session-lock";
import { candidateEmailConfigured, sendCandidateCode } from "./brevo";
import { recordWelcomeEmail } from "./services/candidate-email-notifications";

const SESSION_COOKIE = "nl_candidate";
const CHALLENGE_COOKIE = "nl_email_challenge";
const CHALLENGE_PATH = "/api/candidate";
const CODE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;
const tokenShape = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const cookieOptions = (maxAge: number, path = "/") => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path, maxAge,
});

const emailInput = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Wpisz poprawny adres e-mail."),
}).strict();
const verifyInput = z.object({
  challengeId: z.uuid("Poproś o nowy kod i spróbuj ponownie."),
  code: z.string().trim().regex(/^\d{6}$/, "Wpisz sześciocyfrowy kod z wiadomości e-mail."),
}).strict();

export type CandidateEmailState = {
  enabled: boolean;
  email: string | null;
  verified: boolean;
};

export const candidateEmailEnabled = candidateEmailConfigured;

function assertEnabled() {
  if (!candidateEmailConfigured())
    throw new AppError(503, "email_disabled", "Logowanie e-mailem jest chwilowo niedostępne. Spróbuj później.");
}

function codeHash(id: string, email: string, code: string) {
  // A plain hash would expose all one million possible codes to an offline attack.
  const secret = process.env.CANDIDATE_EMAIL_SECRET;
  if (!secret || secret.length < 32) throw new Error("candidate_email_secret_missing");
  return createHmac("sha256", secret).update(`${id}\0${email}\0${code}`).digest("hex");
}

/** Do not let query parameters, addresses, codes or provider responses enter logs. */
async function operation<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    console.warn(`candidate.email.${name}_failed`);
    throw new AppError(503, "email_unavailable", "Nie udało się obsłużyć logowania e-mailem. Spróbuj ponownie później.");
  }
}

/** Existing credentials remain valid if sending is temporarily disabled. */
export async function getCandidateAuthenticatedSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !tokenShape.test(token)) return null;
  return operation("session", async () => {
    const [row] = await db().select({ sessionId: schema.candidateAccounts.sessionId })
      .from(schema.candidateDeviceSessions)
      .innerJoin(schema.candidateAccounts, eq(schema.candidateAccounts.id, schema.candidateDeviceSessions.accountId))
      .where(and(eq(schema.candidateDeviceSessions.tokenHash, hash(token)), gt(schema.candidateDeviceSessions.expiresAt, new Date())))
      .limit(1);
    return row?.sessionId ?? null;
  });
}

export async function getCandidateEmailState(sessionId: string): Promise<CandidateEmailState> {
  return operation("state", async () => {
    const [account] = await db().select({ email: schema.candidateAccounts.email })
      .from(schema.candidateAccounts).where(eq(schema.candidateAccounts.sessionId, sessionId)).limit(1);
    return { enabled: candidateEmailConfigured(), email: account?.email ?? null, verified: Boolean(account) };
  });
}

/** Grandfather existing applications; only a new contact needs verified email when enabled. */
export async function requireNewCandidateEmail(sessionId: string): Promise<void> {
  if (!candidateEmailConfigured()) return;
  return operation("required", async () => {
    const [contact] = await db().select({ id: schema.visitorContacts.id }).from(schema.visitorContacts)
      .where(eq(schema.visitorContacts.sessionId, sessionId)).limit(1);
    if (contact) return;
    const [account] = await db().select({ id: schema.candidateAccounts.id }).from(schema.candidateAccounts)
      .where(eq(schema.candidateAccounts.sessionId, sessionId)).limit(1);
    if (!account) throw new AppError(403, "email_verification_required", "Potwierdź adres e-mail, aby przejść dalej.");
  });
}

export async function requestCandidateEmail(sessionId: string, input: unknown, ip: string) {
  return operation("request", async () => {
    assertEnabled();
    const { email } = emailInput.parse(input);
    const jar = await cookies();
    const existing = jar.get(CHALLENGE_COOKIE)?.value;
    const browser = existing && tokenShape.test(existing) ? existing : randomBytes(32).toString("base64url");
    const browserHash = hash(browser);
    const emailKey = hash(email);
    await rateLimit(`candidate-code:ip:${hash(ip)}`, 10, 15 * 60);
    await rateLimit(`candidate-code:email:${emailKey}`, 5, 60 * 60);
    await rateLimit(`candidate-code:browser:${browserHash}`, 5, 60 * 60);
    await rateLimit(`candidate-code:cooldown:${emailKey}`, 1, 60);
    await rateLimit(`candidate-code:browser-cooldown:${browserHash}`, 1, 60);
    jar.set(CHALLENGE_COOKIE, browser, cookieOptions(CODE_TTL_SECONDS, CHALLENGE_PATH));

    const id = randomUUID();
    const code = String(randomInt(1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
    await db().insert(schema.candidateEmailChallenges).values({
      id, sessionId, email, browserHash, codeHash: codeHash(id, email, code), expiresAt, status: "sending",
    });
    try {
      // No DB lock is held during network I/O. A code cannot be used until accepted.
      await sendCandidateCode(email, code, id);
      await db().update(schema.candidateEmailChallenges).set({ status: "ready" })
        .where(and(eq(schema.candidateEmailChallenges.id, id), eq(schema.candidateEmailChallenges.status, "sending")));
    } catch {
      await db().update(schema.candidateEmailChallenges).set({ status: "failed" })
        .where(eq(schema.candidateEmailChallenges.id, id));
      throw new AppError(503, "email_send_failed", "Nie udało się wysłać kodu. Spróbuj ponownie za chwilę.");
    }
    // Keep short-lived personal data bounded without depending on a running browser.
    await db().delete(schema.candidateEmailChallenges)
      .where(lt(schema.candidateEmailChallenges.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
    return { challengeId: id, expiresIn: Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)), resendAfter: 60 };
  });
}

type VerifyResult = { error: "invalid" | "expired" | "conflict" } | { token: string; welcomeJobId: string | null };

export async function verifyCandidateEmail(input: unknown, ip: string): Promise<{ verified: true; welcomeJobId: string | null }> {
  return operation("verify", async () => {
    assertEnabled();
    const { challengeId, code } = verifyInput.parse(input);
    const jar = await cookies();
    const browser = jar.get(CHALLENGE_COOKIE)?.value;
    await rateLimit(`candidate-verify:ip:${hash(ip)}`, 60, 15 * 60);
    if (!browser || !tokenShape.test(browser))
      throw new AppError(400, "email_code_invalid", "Kod jest nieprawidłowy lub już wykorzystany. Poproś o nowy kod.");
    const browserHash = hash(browser);
    await rateLimit(`candidate-verify:browser:${browserHash}`, 30, 15 * 60);

    const result = await db().transaction(async (tx): Promise<VerifyResult> => {
      const [challenge] = await tx.select().from(schema.candidateEmailChallenges)
        .where(and(eq(schema.candidateEmailChallenges.id, challengeId), eq(schema.candidateEmailChallenges.browserHash, browserHash)))
        .for("update").limit(1);
      if (!challenge || challenge.status !== "ready" || challenge.attempts >= MAX_ATTEMPTS) return { error: "invalid" };
      const now = new Date();
      if (challenge.expiresAt <= now) {
        await tx.update(schema.candidateEmailChallenges).set({ status: "failed" }).where(eq(schema.candidateEmailChallenges.id, challengeId));
        return { error: "expired" };
      }
      const expected = Buffer.from(challenge.codeHash, "hex");
      const actual = Buffer.from(codeHash(challenge.id, challenge.email, code), "hex");
      const correct = expected.length === actual.length && timingSafeEqual(expected, actual);
      const attempts = challenge.attempts + 1;
      if (!correct) {
        await tx.update(schema.candidateEmailChallenges).set({ attempts, ...(attempts >= MAX_ATTEMPTS ? { status: "failed" } : {}) })
          .where(eq(schema.candidateEmailChallenges.id, challengeId));
        // Return, don't throw: throwing would roll back the failed-attempt counter.
        return { error: "invalid" };
      }
      await tx.update(schema.candidateEmailChallenges).set({ status: "consumed", consumedAt: now, attempts })
        .where(eq(schema.candidateEmailChallenges.id, challengeId));

      // All application data retains its original session ID. Never match on phone/name.
      await lockVisitor(tx, challenge.sessionId);
      let [account] = await tx.select().from(schema.candidateAccounts).where(eq(schema.candidateAccounts.email, challenge.email)).limit(1);
      let welcomeJobId: string | null = null;
      if (!account) {
        const [bound] = await tx.select({ id: schema.candidateAccounts.id }).from(schema.candidateAccounts)
          .where(eq(schema.candidateAccounts.sessionId, challenge.sessionId)).limit(1);
        if (bound) return { error: "conflict" };
        const [created] = await tx.insert(schema.candidateAccounts).values({ sessionId: challenge.sessionId, email: challenge.email })
          .onConflictDoNothing().returning();
        if (created) {
          account = created;
          // After binding, access comes from independent revocable device credentials.
          await tx.update(schema.visitorSessions).set({ tokenHash: hash(randomBytes(32).toString("base64url")) })
            .where(eq(schema.visitorSessions.id, challenge.sessionId));
          welcomeJobId = await recordWelcomeEmail(tx, challenge.sessionId);
        } else {
          // A concurrent verification may have claimed the same email on another device.
          [account] = await tx.select().from(schema.candidateAccounts).where(eq(schema.candidateAccounts.email, challenge.email)).limit(1);
          if (!account) return { error: "conflict" };
        }
      }
      const token = randomBytes(32).toString("base64url");
      await tx.insert(schema.candidateDeviceSessions).values({
        accountId: account.id, tokenHash: hash(token), expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
      });
      return { token, welcomeJobId };
    });
    if ("error" in result) {
      if (result.error === "expired") throw new AppError(400, "email_code_expired", "Kod wygasł. Poproś o nowy kod.");
      if (result.error === "conflict") throw new AppError(409, "email_address_conflict", "Ta aplikacja jest już powiązana z innym adresem e-mail. Wyloguj się, aby zalogować się na inne konto.");
      throw new AppError(400, "email_code_invalid", "Kod jest nieprawidłowy lub już wykorzystany. Poproś o nowy kod.");
    }
    jar.set(SESSION_COOKIE, result.token, cookieOptions(SESSION_TTL_SECONDS));
    jar.set("nl_visitor", "", cookieOptions(0));
    jar.set(CHALLENGE_COOKIE, "", cookieOptions(0, CHALLENGE_PATH));
    // The route dispatches the already-durable welcome after sending login cookies.
    return { verified: true, welcomeJobId: result.welcomeJobId };
  });
}

export async function logoutCandidateEmail(): Promise<void> {
  return operation("logout", async () => {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    const guestToken = jar.get("nl_visitor")?.value;
    const browser = jar.get(CHALLENGE_COOKIE)?.value;
    if (token && tokenShape.test(token)) await db().delete(schema.candidateDeviceSessions).where(eq(schema.candidateDeviceSessions.tokenHash, hash(token)));
    if (guestToken && tokenShape.test(guestToken)) await db().delete(schema.visitorDeviceSessions).where(eq(schema.visitorDeviceSessions.tokenHash, hash(guestToken)));
    if (browser && tokenShape.test(browser)) await db().update(schema.candidateEmailChallenges).set({ status: "failed" })
      .where(eq(schema.candidateEmailChallenges.browserHash, hash(browser)));
    jar.set(SESSION_COOKIE, "", cookieOptions(0));
    jar.set("nl_visitor", "", cookieOptions(0));
    jar.set(CHALLENGE_COOKIE, "", cookieOptions(0, CHALLENGE_PATH));
  });
}
