import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Db } from "@/db";
import { storage } from "../storage";
import { log } from "../log";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

/**
 * A lead exists from the moment the visitor leaves contact details (step 1).
 * Idempotent: the unique index on leads.session_id guarantees one lead per visitor.
 */
export async function ensureLead(tx: Tx, sessionId: string): Promise<number> {
  const find = async () =>
    (await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.sessionId, sessionId)).limit(1))[0];
  // Look up first: an INSERT … ON CONFLICT still consumes an id, which would leave gaps (#1, #4, …).
  let lead = await find();
  if (!lead) {
    const now = new Date();
    await tx.insert(schema.leads).values({ sessionId, createdAt: now, updatedAt: now }).onConflictDoNothing();
    lead = await find();
  }
  // Link an existing conversation (if any) to the lead.
  await tx
    .update(schema.conversations)
    .set({ leadId: lead.id })
    .where(and(eq(schema.conversations.sessionId, sessionId), sql`${schema.conversations.leadId} is null`));
  return lead.id;
}

/** Returns the visitor's conversation, creating it (linked to the lead) if needed. */
export async function ensureConversation(tx: Tx, sessionId: string) {
  const [lead] = await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.sessionId, sessionId)).limit(1);
  await tx
    .insert(schema.conversations)
    .values({ sessionId, leadId: lead?.id ?? null })
    .onConflictDoNothing();
  const [conv] = await tx.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sessionId)).limit(1);
  if (lead && !conv.leadId) {
    await tx.update(schema.conversations).set({ leadId: lead.id }).where(eq(schema.conversations.id, conv.id));
    conv.leadId = lead.id;
  }
  return conv;
}

/**
 * Permanently removes leads with everything that belongs to the visitor:
 * contact, answers, submission, files (DB rows and stored objects), conversation, messages, notes.
 */
export async function deleteLeads(ids: number[]) {
  if (ids.length === 0) return { deleted: 0 };
  const leads = await db()
    .select({ id: schema.leads.id, sessionId: schema.leads.sessionId })
    .from(schema.leads)
    .where(inArray(schema.leads.id, ids));
  if (leads.length === 0) return { deleted: 0 };
  const sessionIds = leads.map((l) => l.sessionId);
  const fileKeys = await db()
    .select({ key: schema.files.storageKey })
    .from(schema.files)
    .where(inArray(schema.files.sessionId, sessionIds));

  // One statement: every visitor table cascades from visitor_sessions.
  await db().delete(schema.visitorSessions).where(inArray(schema.visitorSessions.id, sessionIds));

  for (const { key } of fileKeys) {
    await storage()
      .delete(key)
      .catch((err) => log.warn("leads", "could not delete stored file", { key, error: String(err) }));
  }
  log.info("leads", "leads deleted", { ids: leads.map((l) => l.id) });
  return { deleted: leads.length };
}

/**
 * What happened since `since`: new leads and new visitor messages.
 * The admin panel polls this to play a sound and show a toast.
 */
export async function adminActivity(since: Date) {
  const [newLeads, newMessages] = await Promise.all([
    db()
      .select({ id: schema.leads.id, name: schema.visitorContacts.name, createdAt: schema.leads.createdAt })
      .from(schema.leads)
      .leftJoin(schema.visitorContacts, eq(schema.visitorContacts.sessionId, schema.leads.sessionId))
      .where(gt(schema.leads.createdAt, since))
      .orderBy(desc(schema.leads.createdAt))
      .limit(20),
    db()
      .select({
        leadId: schema.conversations.leadId,
        body: schema.messages.body,
        createdAt: schema.messages.createdAt,
        name: schema.visitorContacts.name,
      })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .leftJoin(schema.visitorContacts, eq(schema.visitorContacts.sessionId, schema.conversations.sessionId))
      .where(and(eq(schema.messages.sender, "visitor"), gt(schema.messages.createdAt, since), isNotNull(schema.conversations.leadId)))
      .orderBy(desc(schema.messages.createdAt))
      .limit(20),
  ]);
  return {
    leads: newLeads.map((l) => ({ id: l.id, name: l.name, at: l.createdAt.toISOString() })),
    messages: newMessages.map((m) => ({
      leadId: m.leadId!,
      name: m.name,
      preview: m.body.slice(0, 120),
      at: m.createdAt.toISOString(),
    })),
  };
}
