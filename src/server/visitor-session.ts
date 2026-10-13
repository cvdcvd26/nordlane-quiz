import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { unauthorized } from "./errors";
import { content } from "@/config/content";

const COOKIE = "nl_visitor";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

async function findByToken(token: string | undefined) {
  if (!token || token.length < 32) return null;
  const rows = await db()
    .select({ id: schema.visitorSessions.id })
    .from(schema.visitorSessions)
    .where(eq(schema.visitorSessions.tokenHash, hash(token)))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * The session id is never taken from the client: the browser only holds a random
 * 256-bit token in an httpOnly cookie; the server maps its hash to the session.
 */
export async function getVisitorSessionId(): Promise<string | null> {
  const jar = await cookies();
  return findByToken(jar.get(COOKIE)?.value);
}

export async function requireVisitorSessionId(): Promise<string> {
  const id = await getVisitorSessionId();
  if (!id) throw unauthorized(content.errors.sessionMissing);
  return id;
}

export async function getOrCreateVisitorSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = await findByToken(jar.get(COOKIE)?.value);
  if (existing) {
    await db()
      .update(schema.visitorSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.visitorSessions.id, existing));
    return existing;
  }
  const token = randomBytes(32).toString("base64url");
  const [row] = await db().insert(schema.visitorSessions).values({ tokenHash: hash(token) }).returning();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return row.id;
}
