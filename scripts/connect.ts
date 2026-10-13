/** DB connection for CLI scripts: Neon over WebSocket, or a regular Postgres on localhost. */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import ws from "ws";

export function connect(url: string) {
  if (/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg({ client: pool });
    return { db, migrate: (folder: string) => migratePg(db, { migrationsFolder: folder }), end: () => pool.end() };
  }
  neonConfig.webSocketConstructor = typeof WebSocket !== "undefined" ? WebSocket : ws;
  const pool = new Pool({ connectionString: url });
  const db = drizzle({ client: pool });
  return { db, migrate: (folder: string) => migrate(db, { migrationsFolder: folder }), end: () => pool.end() };
}

export function databaseUrl() {
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}
