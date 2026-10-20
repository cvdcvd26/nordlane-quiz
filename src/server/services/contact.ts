import { lockVisitor } from "../session-lock";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { content } from "@/config/content";
import { normalizePhone, normalizeTelegram } from "@/lib/contact";
import { ensureLead } from "./leads";

const e = content.errors;

export const contactSchema = z.object({
  name: z.string().trim().min(1, e.nameRequired).max(100, e.nameTooLong),
  phone: z
    .string()
    .trim()
    .min(1, e.phoneRequired)
    .transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) ctx.addIssue({ code: "custom", message: e.phoneInvalid });
      return n ?? "";
    }),
  telegram: z
    .string()
    .optional()
    .nullable()
    .transform((v, ctx) => {
      const n = normalizeTelegram(v ?? "");
      if (n === false) ctx.addIssue({ code: "custom", message: e.telegramInvalid });
      return n || null;
    }),
});

export type Contact = { name: string; phone: string; telegram: string | null };

export async function saveContact(sessionId: string, input: unknown): Promise<Contact> {
  const c = contactSchema.parse(input);
  const now = new Date();
  await db().transaction(async (tx) => {
    await lockVisitor(tx, sessionId);
    await tx
      .insert(schema.visitorContacts)
      .values({ sessionId, ...c })
      .onConflictDoUpdate({ target: schema.visitorContacts.sessionId, set: { ...c, updatedAt: now } });
    // The lead is created as soon as contact details are saved.
    const leadId = await ensureLead(tx, sessionId);
    await tx.update(schema.leads).set({ updatedAt: now }).where(eq(schema.leads.id, leadId));
  });
  return c;
}

export async function getContact(sessionId: string): Promise<Contact | null> {
  const [row] = await db()
    .select({ name: schema.visitorContacts.name, phone: schema.visitorContacts.phone, telegram: schema.visitorContacts.telegram })
    .from(schema.visitorContacts)
    .where(eq(schema.visitorContacts.sessionId, sessionId))
    .limit(1);
  return row ?? null;
}
