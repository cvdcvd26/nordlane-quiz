import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/** Ignore system messages; sequence orders replies even when timestamps are equal. */
export function replyQueueFields() {
  const pendingVisitor = sql`c.session_id = "leads"."session_id" and m.sender = 'visitor' and m.deleted_at is null
    and m.sequence > coalesce((select max(a.sequence) from messages a
      where a.conversation_id = c.id and a.sender = 'admin' and a.deleted_at is null), 0)`;
  const waitingAt = sql`case when "leads"."candidate_result_published_at" is null then
    (select m.created_at from messages m join conversations c on c.id = m.conversation_id
      where ${pendingVisitor} order by m.sequence asc limit 1) else null end`;
  return {
    waitingAt,
    needsReply: sql<boolean>`${waitingAt} is not null`,
    replyWaitingSince: sql<string | null>`${waitingAt}`.mapWith(value => value ? new Date(value).toISOString() : null),
    lastVisitorMessage: sql<string | null>`case when ${waitingAt} is not null then
      (select left(m.body, 180) from messages m join conversations c on c.id = m.conversation_id
        where ${pendingVisitor} order by m.sequence desc limit 1) else null end`,
  };
}

export async function getReplyQueueState(leadId: number) {
  const { needsReply, replyWaitingSince } = replyQueueFields();
  const [state] = await db().select({ needsReply, replyWaitingSince }).from(schema.leads).where(eq(schema.leads.id, leadId));
  return state ?? { needsReply: false, replyWaitingSince: null };
}
