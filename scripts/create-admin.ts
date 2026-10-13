/**
 * Creates or resets an administrator from the terminal:
 *   DATABASE_URL=... npm run admin:create -- admin@example.com 'long-password'
 * The password is stored as a bcrypt hash; existing sessions of that admin are invalidated.
 */
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { adminUsers } from "../src/db/schema";
import { connect, databaseUrl } from "./connect";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.error("Usage: npm run admin:create -- <email> <password (10+ chars)>");
    process.exit(1);
  }
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set");
  const conn = connect(url);
  const db = conn.db;
  const passwordHash = await bcrypt.hash(password, 12);
  const normalized = email.trim().toLowerCase();
  const existing = await db.select().from(adminUsers).where(eq(adminUsers.email, normalized));
  if (existing.length) {
    await db
      .update(adminUsers)
      .set({ passwordHash, tokenVersion: sql`${adminUsers.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(adminUsers.email, normalized));
    console.log(`Password reset for ${normalized}.`);
  } else {
    await db.insert(adminUsers).values({ email: normalized, passwordHash });
    console.log(`Admin ${normalized} created.`);
  }
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
