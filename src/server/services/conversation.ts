import { eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Db } from "@/db";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0] | Db;

/**
 * After any new message: bump conversation activity and, if a lead exists,
 * recompute its counters from the source of truth (the messages table).
 */
export async function touchConversation(tx: Tx, conversationId: string, at: Date) {
  const [conv] = await tx
    .update(schema.conversations)
    .set({ lastMessageAt: at })
    .where(eq(schema.conversations.id, conversationId))
    .returning();
  if (conv?.leadId) await refreshLeadStats(tx, conv.leadId, conversationId);
  return conv;
}

export async function refreshLeadStats(tx: Tx, leadId: number, conversationId: string) {
  await tx
    .update(schema.leads)
    .set({
      messageCount: sql`(select count(*)::int from messages m where m.conversation_id = ${conversationId})`,
      lastMessageAt: sql`(select max(m.created_at) from messages m where m.conversation_id = ${conversationId})`,
      updatedAt: new Date(),
    })
    .where(eq(schema.leads.id, leadId));
}
