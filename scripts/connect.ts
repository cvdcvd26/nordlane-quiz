/** DB connection for CLI scripts: Neon over WebSocket, or a regular Postgres on localhost. */
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import ws from "ws";

/** Any constant: the same number serialises all migration runs against one database. */
const MIGRATION_LOCK_ID = 727_274_001;

const isLocal = (url: string) => /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

export function connect(url: string) {
  if (isLocal(url)) {
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const db = drizzlePg({ client: pool });
    return {
      db,
      migrate: async (folder: string) => {
        const client = await pool.connect();
        try {
          await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
          await migratePg(drizzlePg({ client }), { migrationsFolder: folder });
        } finally {
          await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
          client.release();
        }
      },
      end: () => pool.end(),
    };
  }

  neonConfig.webSocketConstructor = typeof WebSocket !== "undefined" ? WebSocket : ws;
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle({ client: pool });
  return {
    db,
    /**
     * Vercel can build Production and Preview at the same time. A session-level advisory lock
     * makes the second build wait, then see the migrations as already applied and skip them.
     */
    migrate: async (folder: string) => {
      const client = await pool.connect();
      try {
        await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PoolClient is accepted at runtime
        await migrate(drizzle({ client: client as any }), { migrationsFolder: folder });
      } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

/**
 * Migrations prefer the direct (unpooled) Neon URL: advisory locks and DDL need a real session,
 * which the PgBouncer pooler does not guarantee.
 */
export function databaseUrl(forMigrations = false) {
  if (forMigrations) {
    return process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  }
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}
