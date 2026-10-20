import { z } from "zod";
import { db, schema } from "@/db";
import { defaultSettings, type EditableSettings } from "@/config/settings";
import { content } from "@/config/content";

export const settingsSchema = z
  .object({
    autoMessageEnabled: z.boolean(),
    autoMessageText: z.string().trim().min(1).max(4000),
    autoMessageMinDelaySeconds: z.number().int().min(0).max(24 * 60 * 60),
    autoMessageMaxDelaySeconds: z.number().int().min(0).max(24 * 60 * 60),
    chatAttachmentsEnabled: z.boolean(),
  })
  .refine((s) => s.autoMessageMaxDelaySeconds >= s.autoMessageMinDelaySeconds, {
    message: content.admin.settings.delayOrder,
    path: ["autoMessageMaxDelaySeconds"],
  });

export async function getSettings(): Promise<EditableSettings> {
  const rows = await db().select().from(schema.appSettings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  // Preserve explicitly saved intervals from versions that stored minutes.
  for (const bound of ["Min", "Max"] as const) {
    const seconds = `autoMessage${bound}DelaySeconds`;
    const minutes = stored[`autoMessage${bound}DelayMinutes`];
    if (stored[seconds] === undefined && typeof minutes === "number") stored[seconds] = minutes * 60;
  }
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
export function pickDelayMs(s: Pick<EditableSettings, "autoMessageMinDelaySeconds" | "autoMessageMaxDelaySeconds">) {
  const min = s.autoMessageMinDelaySeconds * 1000;
  const max = s.autoMessageMaxDelaySeconds * 1000;
  return Math.round(min + Math.random() * (max - min));
}
