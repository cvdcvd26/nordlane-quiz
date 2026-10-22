import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { defaultQuickReplies, quickRepliesUpdateSchema, type QuickReplies } from "@/lib/quick-replies";
import { conflict } from "../errors";

const KEY = "admin.quick_replies.v1";

export async function getQuickReplies(): Promise<QuickReplies> {
  const [row] = await db().select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  if (!row) return { revision: null, replies: defaultQuickReplies.map(reply => ({ ...reply })) };
  return quickRepliesUpdateSchema.parse(row.value);
}

/** An atomic revision check prevents one administrator from overwriting another's edits. */
export async function updateQuickReplies(input: unknown): Promise<QuickReplies> {
  const parsed = quickRepliesUpdateSchema.parse(input);
  const next = { revision: randomUUID(), replies: parsed.replies };
  const saved = parsed.revision === null
    ? await db().insert(schema.appSettings).values({ key: KEY, value: next }).onConflictDoNothing().returning({ key: schema.appSettings.key })
    : await db().update(schema.appSettings).set({ value: next, updatedAt: new Date() })
      .where(and(eq(schema.appSettings.key, KEY), sql`${schema.appSettings.value}->>'revision' = ${parsed.revision}`))
      .returning({ key: schema.appSettings.key });
  if (!saved.length) throw conflict("Quick replies changed. Reload before saving.", "quick_replies_changed");
  return next;
}
