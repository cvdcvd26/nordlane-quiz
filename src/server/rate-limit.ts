import { sql, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { tooMany } from "./errors";
import { content } from "@/config/content";

/**
 * Fixed-window limiter stored in Postgres: works across all serverless instances.
 * Throws 429 when `key` exceeds `limit` hits within `windowSeconds`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db()
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });

  // Occasional cleanup of stale windows.
  if (Math.random() < 0.02) {
    await db()
      .delete(schema.rateLimits)
      .where(lt(schema.rateLimits.windowStart, new Date(Date.now() - 24 * 3600 * 1000)));
  }

  if ((rows[0]?.count ?? 0) > limit) throw tooMany(content.errors.rateLimited);
}

/** Clears counters for a key (e.g. after a successful login). */
export async function resetRateLimit(keyPrefix: string) {
  await db().delete(schema.rateLimits).where(sql`${schema.rateLimits.key} = ${keyPrefix}`);
}
