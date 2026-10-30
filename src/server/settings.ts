import { z } from "zod";
import { db, schema } from "@/db";
import { defaultSettings, type EditableSettings } from "@/config/settings";
import { content } from "@/config/content";

export const settingsSchema = z
  .object({
    autoMessageEnabled: z.boolean(),
    autoMessageText: z.string().trim().min(1).max(4000),
    // Accepted for older admin clients; new acknowledgements always send immediately.
    autoMessageMinDelaySeconds: z.number().int().min(0).max(24 * 60 * 60).default(0),
    autoMessageMaxDelaySeconds: z.number().int().min(0).max(24 * 60 * 60).default(0),
    chatAttachmentsEnabled: z.boolean(),
  })
  .refine((s) => s.autoMessageMaxDelaySeconds >= s.autoMessageMinDelaySeconds, {
    message: content.admin.settings.delayOrder,
    path: ["autoMessageMaxDelaySeconds"],
  });

export async function getSettings(): Promise<EditableSettings> {
  const rows = await db().select().from(schema.appSettings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const merged = { ...defaultSettings, ...stored, autoMessageMinDelaySeconds: 0, autoMessageMaxDelaySeconds: 0 };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : defaultSettings;
}

export async function updateSettings(input: unknown): Promise<EditableSettings> {
  const next = { ...settingsSchema.parse(input), autoMessageMinDelaySeconds: 0, autoMessageMaxDelaySeconds: 0 };
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
