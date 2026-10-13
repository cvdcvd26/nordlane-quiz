import { z } from "zod";
import { db, schema } from "@/db";
import { defaultSettings, type EditableSettings } from "@/config/settings";
import { content } from "@/config/content";

export const settingsSchema = z
  .object({
    autoMessageEnabled: z.boolean(),
    autoMessageText: z.string().trim().min(1).max(4000),
    autoMessageMinDelayMinutes: z.number().int().min(0).max(24 * 60),
    autoMessageMaxDelayMinutes: z.number().int().min(0).max(24 * 60),
    chatAttachmentsEnabled: z.boolean(),
  })
  .refine((s) => s.autoMessageMaxDelayMinutes >= s.autoMessageMinDelayMinutes, {
    message: content.admin.settings.delayOrder,
    path: ["autoMessageMaxDelayMinutes"],
  });

export async function getSettings(): Promise<EditableSettings> {
  const rows = await db().select().from(schema.appSettings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const merged = { ...defaultSettings, ...stored };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSettings;
}

export async function updateSettings(input: unknown): Promise<EditableSettings> {
  const next = settingsSchema.parse(input);
  const now = new Date();
  await db().transaction(async (tx) => {
    for (const [key, value] of Object.entries(next)) {
      await tx
        .insert(schema.appSettings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: now } });
    }
  });
  return next;
}

/** Random delay chosen on the server, in milliseconds, within the configured range. */
export function pickDelayMs(s: Pick<EditableSettings, "autoMessageMinDelayMinutes" | "autoMessageMaxDelayMinutes">) {
  const min = s.autoMessageMinDelayMinutes * 60_000;
  const max = s.autoMessageMaxDelayMinutes * 60_000;
  return Math.round(min + Math.random() * (max - min));
}
