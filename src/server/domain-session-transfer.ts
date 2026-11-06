import "server-only";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Db } from "@/db";
import { domainMigrationEnabled, migrationDestination, MIGRATION_CHECKED_COOKIE, MIGRATION_NONCE_COOKIE, siteDomains } from "@/config/site-domains";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";
import { credentialHash, findGuestCredentialHash, tokenShape, VISITOR_MAX_AGE } from "./visitor-credentials";
import { lockVisitor } from "./session-lock";

const TRANSFER_TTL_MS = 5 * 60_000;
const GRANT_TTL_MS = 90_000;
const NONCE_PATH = "/";
const table = schema.domainSessionTransfers;
const cookieOptions = (maxAge: number, path = "/") => ({ httpOnly: true, secure: true, sameSite: "lax" as const, path, maxAge });
const failed = () => new AppError(400, "transfer_invalid", "Nie udało się przywrócić sesji. Spróbuj ponownie.");
type Access = { kind: "candidate" | "guest"; sessionId: string; tokenHash: string; expiresAt: Date; accountId?: string; parentTokenHash?: string };

export function assertTransferHost(requestUrl: string, expected: string) {
  const parsed = new URL(requestUrl);
  if (!domainMigrationEnabled() || parsed.origin !== expected || parsed.username || parsed.password)
    throw new AppError(404, "not_found", "Nie znaleziono strony.");
}

async function resolveAccess(kind: Access["kind"], tokenHash: string, connection: Db, now: Date): Promise<Access | null> {
  if (kind === "guest") {
    const guest = await findGuestCredentialHash(tokenHash, connection, now);
    return guest ? { ...guest, kind, tokenHash } : null;
  }
  const [candidate] = await connection.select({ sessionId: schema.candidateAccounts.sessionId,
    accountId: schema.candidateAccounts.id, expiresAt: schema.candidateDeviceSessions.expiresAt })
    .from(schema.candidateDeviceSessions).innerJoin(schema.candidateAccounts,
      eq(schema.candidateAccounts.id, schema.candidateDeviceSessions.accountId))
    .where(and(eq(schema.candidateDeviceSessions.tokenHash, tokenHash), gt(schema.candidateDeviceSessions.expiresAt, now))).limit(1);
  return candidate ? { ...candidate, kind, tokenHash } : null;
}

async function browserAccess(connection: Db, now: Date): Promise<Access | null> {
  const jar = await cookies();
  const candidate = jar.get("nl_candidate")?.value;
  if (candidate && tokenShape.test(candidate)) {
    const access = await resolveAccess("candidate", credentialHash(candidate), connection, now);
    if (access) return access;
  }
  const guest = jar.get("nl_visitor")?.value;
  return guest && tokenShape.test(guest) ? resolveAccess("guest", credentialHash(guest), connection, now) : null;
}

async function hasApplication(access: Access, connection: Db) {
  if (access.kind === "candidate") return true;
  const [contact] = await connection.select({ id: schema.visitorContacts.id }).from(schema.visitorContacts)
    .where(eq(schema.visitorContacts.sessionId, access.sessionId)).limit(1);
  return Boolean(contact);
}

async function cleanup(now: Date) {
  // Bounded maintenance, without relying on a second scheduler or ever touching leads.
  const expired = await db().select({ id: table.id }).from(table)
    .where(lt(table.expiresAt, new Date(now.getTime() - 24 * 3600_000))).limit(100);
  if (expired.length) await db().delete(table).where(inArray(table.id, expired.map(row => row.id)));
  const devices = await db().select({ id: schema.visitorDeviceSessions.id }).from(schema.visitorDeviceSessions)
    .where(lt(schema.visitorDeviceSessions.expiresAt, now)).limit(100);
  if (devices.length) await db().delete(schema.visitorDeviceSessions).where(inArray(schema.visitorDeviceSessions.id, devices.map(row => row.id)));
}

/** New-origin nonce first. No visitor, lead or candidate account is created here. */
export async function startDomainSessionTransfer(requestUrl: string, destination: string | null, ip: string, now = new Date()) {
  assertTransferHost(requestUrl, siteDomains.canonical);
  await rateLimit(`domain-transfer:start:${credentialHash(ip)}`, 60, 10 * 60);
  const jar = await cookies();
  const path = migrationDestination(destination);
  const existing = await browserAccess(db(), now);
  if (existing && await hasApplication(existing, db())) {
    jar.set(MIGRATION_CHECKED_COOKIE, "1", cookieOptions(VISITOR_MAX_AGE));
    return `${siteDomains.canonical}${path}`;
  }
  const nonce = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await cleanup(now);
  await db().insert(table).values({ id, browserHash: credentialHash(nonce), destination: path,
    expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS) });
  jar.set(MIGRATION_NONCE_COOKIE, nonce, cookieOptions(TRANSFER_TTL_MS / 1000, NONCE_PATH));
  return `${siteDomains.legacy}/session-transfer/authorize?state=${id}`;
}

/** A grant goes only to the fixed new origin, never to a client-supplied return URL. */
export async function authorizeDomainSessionTransfer(requestUrl: string, state: string | null, ip: string, now = new Date()) {
  assertTransferHost(requestUrl, siteDomains.legacy);
  if (!z.uuid().safeParse(state).success) throw failed();
  await rateLimit(`domain-transfer:authorize:${credentialHash(ip)}`, 120, 10 * 60);
  const source = await browserAccess(db(), now);
  const access = source && await hasApplication(source, db()) ? source : null;
  const grant = randomBytes(32).toString("base64url");
  await db().transaction(async tx => {
    const [request] = await tx.select().from(table).where(eq(table.id, state!)).for("update");
    if (!request || request.expiresAt <= now || request.consumedAt || request.grantHash) throw failed();
    await tx.update(table).set({ grantHash: credentialHash(grant), sourceSessionId: access?.sessionId ?? null,
      sourceKind: access?.kind ?? null, sourceTokenHash: access?.tokenHash ?? null,
      expiresAt: new Date(Math.min(request.expiresAt.getTime(), now.getTime() + GRANT_TTL_MS)) }).where(eq(table.id, request.id));
  });
  // Fragments are never sent in HTTP requests or referrers. The isolated finish
  // page removes it before any network request; no cookie/token enters a query.
  return `${siteDomains.canonical}/session-transfer/complete#state=${state}&code=${grant}`;
}

const redeemInput = z.object({ state: z.uuid(), code: z.string().regex(tokenShape) }).strict();
const equalHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function completeDomainSessionTransfer(requestUrl: string, input: unknown, ip: string, now = new Date()) {
  assertTransferHost(requestUrl, siteDomains.canonical);
  const parsed = redeemInput.safeParse(input);
  if (!parsed.success) throw failed();
  await rateLimit(`domain-transfer:complete:${credentialHash(ip)}`, 120, 10 * 60);
  const jar = await cookies();
  const nonce = jar.get(MIGRATION_NONCE_COOKIE)?.value;
  if (!nonce || !tokenShape.test(nonce)) throw failed();
  const { state, code } = parsed.data;
  const result = await db().transaction(async tx => {
    const [request] = await tx.select().from(table).where(eq(table.id, state)).for("update");
    if (!request || request.consumedAt || request.expiresAt <= now || !request.grantHash ||
        !equalHash(request.browserHash, credentialHash(nonce)) || !equalHash(request.grantHash, credentialHash(code))) throw failed();
    // Consume atomically, even if no previous application existed on this browser.
    await tx.update(table).set({ consumedAt: now }).where(eq(table.id, state));
    const destination = migrationDestination(request.destination);
    const initialCurrent = await browserAccess(tx, now);
    const source = request.sourceKind && request.sourceTokenHash
      ? await resolveAccess(request.sourceKind as Access["kind"], request.sourceTokenHash, tx, now) : null;
    if (!source || source.sessionId !== request.sourceSessionId) return { destination, credential: null };
    // Contact writes and email verification use this same lock. Lock both in a
    // stable order so a second tab cannot populate the destination mid-transfer.
    const lockedIds = [...new Set([source.sessionId, ...(initialCurrent ? [initialCurrent.sessionId] : [])])].sort();
    for (const sessionId of lockedIds) await lockVisitor(tx, sessionId);
    // Serialize with device logout as well as application writes. The original
    // guest credential is already protected by the visitor row lock above.
    const credentialTable = source.kind === "candidate" ? schema.candidateDeviceSessions : schema.visitorDeviceSessions;
    await tx.select({ id: credentialTable.id }).from(credentialTable).where(eq(credentialTable.tokenHash, source.tokenHash)).for("update");
    // Re-read after the visitor lock so email binding/revocation cannot race a guest transfer.
    const valid = await resolveAccess(source.kind, source.tokenHash, tx, now);
    if (!valid) return { destination, credential: null };
    const current = await browserAccess(tx, now);
    if (current?.sessionId === source.sessionId) return { destination, credential: null };
    // Another tab may have logged in or saved a contact during the round trip.
    // Preserve that identity; never replace a populated destination application.
    if (current && await hasApplication(current, tx)) return { destination: "/?account=1", credential: null };
    const token = randomBytes(32).toString("base64url");
    if (valid.kind === "candidate") {
      await tx.insert(schema.candidateDeviceSessions).values({ accountId: valid.accountId!, tokenHash: credentialHash(token), expiresAt: valid.expiresAt });
    } else {
      await tx.insert(schema.visitorDeviceSessions).values({ sessionId: valid.sessionId, tokenHash: credentialHash(token),
        parentTokenHash: valid.parentTokenHash!, expiresAt: valid.expiresAt });
    }
    return { destination, credential: { kind: valid.kind, token, maxAge: Math.max(1, Math.floor((valid.expiresAt.getTime() - now.getTime()) / 1000)) } };
  });
  if (result.credential) {
    const { kind, token, maxAge } = result.credential;
    jar.set(kind === "candidate" ? "nl_candidate" : "nl_visitor", token, cookieOptions(maxAge));
    jar.set(kind === "candidate" ? "nl_visitor" : "nl_candidate", "", cookieOptions(0));
  }
  jar.set(MIGRATION_NONCE_COOKIE, "", cookieOptions(0, NONCE_PATH));
  jar.set(MIGRATION_CHECKED_COOKIE, "1", cookieOptions(VISITOR_MAX_AGE));
  return { destination: result.destination };
}

/** Explicit fallback only skips recovery; it grants no application access. */
export async function skipDomainSessionTransfer(requestUrl: string) {
  assertTransferHost(requestUrl, siteDomains.canonical);
  const jar = await cookies();
  jar.set(MIGRATION_NONCE_COOKIE, "", cookieOptions(0, NONCE_PATH));
  jar.set(MIGRATION_CHECKED_COOKIE, "1", cookieOptions(VISITOR_MAX_AGE));
  return `${siteDomains.canonical}/?account=1`;
}
