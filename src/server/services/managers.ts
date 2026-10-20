import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ManagerProfile } from "@/config/managers";

const publicFields = {
  id: schema.managers.id,
  name: schema.managers.name,
  avatar: schema.managers.avatar,
};

/** Read the persisted assignment; displaying or polling a chat never reassigns it. */
export async function getSessionManager(sessionId: string): Promise<ManagerProfile> {
  const [manager] = await db()
    .select(publicFields)
    .from(schema.managers)
    .innerJoin(schema.leads, eq(schema.leads.managerId, schema.managers.id))
    .where(eq(schema.leads.sessionId, sessionId))
    .limit(1);
  if (!manager) throw new Error("The lead has no assigned HR manager");
  return manager;
}

export async function getManager(managerId: string): Promise<ManagerProfile> {
  const [manager] = await db().select(publicFields).from(schema.managers)
    .where(eq(schema.managers.id, managerId)).limit(1);
  if (!manager) throw new Error("HR manager not found");
  return manager;
}
