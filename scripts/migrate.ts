/**
 * Applies SQL migrations from ./drizzle. Runs automatically on Vercel before `next build`.
 * Without DATABASE_URL it skips (so the very first deploy, before the DB is connected, still builds).
 */
import { connect, databaseUrl } from "./connect";

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.warn("[migrate] DATABASE_URL is not set — skipping migrations.");
    return;
  }
  const conn = connect(url);
  await conn.migrate("./drizzle");
  await conn.end();
  console.log("[migrate] migrations applied.");
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
