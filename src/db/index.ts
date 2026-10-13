import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let instance: Db | null = null;

/** Returns the shared database client (Neon over WebSocket — supports transactions). */
export function db(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Connect a Postgres database (Neon) in Vercel → Storage.");
  if (isLocalPostgres(url)) {
    // Local development against a regular Postgres (Docker etc.).
    const max = Number(process.env.PG_POOL_MAX ?? 10);
    instance = drizzlePg({ client: new pg.Pool({ connectionString: url, max }), schema }) as unknown as Db;
    return instance;
  }
  if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: url });
  instance = drizzle({ client: pool, schema }) as unknown as Db;
  return instance;
}

export const isLocalPostgres = (url: string) => /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

/** Test hook: run the same service code against an in-process Postgres (PGlite). */
export function setDb(next: Db | null) {
  instance = next;
}

export { schema };
