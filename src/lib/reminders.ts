import { z } from "zod";

export const REMINDER_TIME_ZONE = "Europe/Warsaw";
export const REMINDER_PAGE_SIZE = 50;
export const REMINDER_BODY_LIMIT = 500;
export type ReminderFilter = "all" | "due" | "upcoming" | "done";
export type LeadReminder = {
  id: string; leadId: number; name: string | null; body: string; dueAt: string;
  completedAt: string | null; revision: number; createdAt: string; updatedAt: string;
};
export type ReminderList = {
  reminders: LeadReminder[]; total: number; offset: number;
  counts: Record<ReminderFilter, number>; now: string;
};

/** A shared list may shrink between polls while this administrator is on its last page. */
export function clampReminderOffset(offset: number, total: number): number {
  const lastPage = Math.max(0, Math.ceil(total / REMINDER_PAGE_SIZE) - 1);
  return Math.min(offset, lastPage * REMINDER_PAGE_SIZE);
}

const reminderFields = {
  body: z.string().trim().min(1).max(REMINDER_BODY_LIMIT),
  dueAt: z.iso.datetime({ offset: true }).refine(value => {
    if (!Number.isFinite(new Date(value).getTime())) return false;
    const year = Number(toWarsawInput(value).slice(0, 4));
    return year >= 2000 && year <= 2100;
  }),
};
const revision = z.number().int().min(0).max(2147483646);
export const reminderCreateSchema = z.object(reminderFields).strict();
export const reminderUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), revision, ...reminderFields }).strict(),
  z.object({ action: z.literal("complete"), revision }).strict(),
  z.object({ action: z.literal("reopen"), revision }).strict(),
]);
export const reminderDeleteSchema = z.object({ revision }).strict();
export const reminderListSchema = z.object({
  filter: z.enum(["all", "due", "upcoming", "done"]).default("due"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

const warsawParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: REMINDER_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit",
});

/** HTML datetime-local values have no zone. Always display Poland's wall clock. */
export function toWarsawInput(value: string | Date): string {
  const parts = Object.fromEntries(warsawParts.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Return every real UTC instant for a Warsaw wall time. A DST gap has no match;
 * an autumn repeated hour has two, so the form asks which occurrence is intended.
 * No conversion depends on the browser/server's local time zone.
 */
export function warsawTimeCandidates(value: string): string[] {
  const match = /^(20\d{2}|2100)-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return [];
  const [, year, month, day, hour, minute] = match.map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(wall)) return [];
  // Poland uses UTC+01 or UTC+02 throughout the supported years.
  return [wall - 2 * 3600000, wall - 3600000]
    .filter(instant => toWarsawInput(new Date(instant)) === value)
    .map(instant => new Date(instant).toISOString());
}

export function formatReminderTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: REMINDER_TIME_ZONE, dateStyle: "medium", timeStyle: "short", hourCycle: "h23",
  }).format(new Date(value));
}
