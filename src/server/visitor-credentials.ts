import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, schema, type Db } from "@/db";

export const VISITOR_MAX_AGE = 180 * 24 * 60 * 60;
export const tokenShape = /^[A-Za-z0-9_-]{43}$/;
export const credentialHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Accept both original host-only credentials and independently revocable transfers. */
export async function findGuestCredentialHash(tokenHash: string, connection: Db = db(), now = new Date()) {
  const threshold = new Date(now.getTime() - VISITOR_MAX_AGE * 1000);
  const [legacy] = await connection.select().from(schema.visitorSessions)
    .where(and(eq(schema.visitorSessions.tokenHash, tokenHash), gt(schema.visitorSessions.createdAt, threshold))).limit(1);
  if (legacy) return { sessionId: legacy.id, parentTokenHash: legacy.tokenHash, migrated: false,
    expiresAt: new Date(legacy.createdAt.getTime() + VISITOR_MAX_AGE * 1000) };
  const [device] = await connection.select({ sessionId: schema.visitorSessions.id,
    parentTokenHash: schema.visitorSessions.tokenHash, expiresAt: schema.visitorDeviceSessions.expiresAt })
    .from(schema.visitorDeviceSessions).innerJoin(schema.visitorSessions,
      and(eq(schema.visitorSessions.id, schema.visitorDeviceSessions.sessionId),
        eq(schema.visitorSessions.tokenHash, schema.visitorDeviceSessions.parentTokenHash)))
    .where(and(eq(schema.visitorDeviceSessions.tokenHash, tokenHash), gt(schema.visitorDeviceSessions.expiresAt, now),
      gt(schema.visitorSessions.createdAt, threshold))).limit(1);
  return device ? { ...device, migrated: true } : null;
}

export async function findGuestCredential(token: string | undefined) {
  return token && tokenShape.test(token) ? findGuestCredentialHash(credentialHash(token)) : null;
}
