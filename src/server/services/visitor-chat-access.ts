import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { QUESTION_KEYS } from "@/config/content";
import { AppError } from "../errors";
import type { Transaction } from "../session-lock";

/** Chat opens at the task stage; historical submitted sessions keep their access. */
export async function requireVisitorChatAccess(executor: Db | Transaction, sessionId: string) {
  const [state] = await executor.select({
    submitted: sql<boolean>`exists (select 1 from task_submissions ts where ts.session_id = ${sessionId})`,
    contactSaved: sql<boolean>`exists (select 1 from visitor_contacts vc where vc.session_id = ${sessionId})`,
    answered: sql<number>`(select count(*)::int from quiz_answers qa
      where qa.session_id = ${sessionId} and qa.question_key in ${QUESTION_KEYS} and qa.answer <> '')`,
  }).from(schema.visitorSessions).where(eq(schema.visitorSessions.id, sessionId)).limit(1);

  if (state?.submitted || (state?.contactSaved && state.answered === QUESTION_KEYS.length)) return;
  throw new AppError(403, "chat_not_available", "Czat będzie dostępny po zapisaniu danych kontaktowych i odpowiedzi na trzy pytania.");
}
