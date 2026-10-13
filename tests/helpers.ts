import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setDb, schema, type Db } from "@/db";
import { setStorage, type FileStorage } from "@/server/storage";
import { setQueue, type JobQueue } from "@/server/queue";

/**
 * Real PostgreSQL (PGlite = Postgres compiled to WASM) with the real migrations.
 * Only the two external network services (Vercel Blob, QStash) are replaced by
 * in-memory doubles that record calls.
 */
export async function setupTestEnv() {
  const client = new PGlite();
  const db = drizzle({ client, schema }) as unknown as Db;
  await migrate(drizzle({ client }), { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  setDb(db);

  const blobs = new Map<string, Buffer>();
  const storage: FileStorage = {
    async put(key, data) {
      blobs.set(key, data);
    },
    async get(key) {
      const b = blobs.get(key);
      return b ? { stream: new Blob([new Uint8Array(b)]).stream(), size: b.length } : null;
    },
    async delete(key) {
      blobs.delete(key);
    },
  };
  setStorage(storage);

  const queued: { id: string; at: Date }[] = [];
  const queueImpl: JobQueue & { failNext: boolean } = {
    failNext: false,
    async scheduleDelivery(id, at) {
      if (queueImpl.failNext) {
        queueImpl.failNext = false;
        throw new Error("queue unavailable");
      }
      queued.push({ id, at });
      return `msg_${queued.length}`;
    },
  };
  setQueue(queueImpl);

  return { db, client, blobs, queued, queue: queueImpl };
}

export async function newSession(db: Db) {
  const [s] = await db.insert(schema.visitorSessions).values({ tokenHash: randomUUID() }).returning();
  return s.id;
}

/** Minimal valid images/PDF built from their real magic bytes. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
export const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
export const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff]);
