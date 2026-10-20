import { eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { notFound } from "./errors";

export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** All writes for a visitor take this lock first, including message sequencing. */
export async function lockVisitor(tx: Transaction, sessionId: string) {
  const [session] = await tx.select({ id: schema.visitorSessions.id }).from(schema.visitorSessions)
    .where(eq(schema.visitorSessions.id, sessionId)).for("update");
  if (!session) throw notFound();
}
