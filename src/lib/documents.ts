import { z } from "zod";

export const CONTRACT_LIMITS = {
  fullName: { min: 2, max: 160 },
  address: { min: 5, max: 300 },
  year: { min: 1900, max: 2100 },
} as const;

// Formatting and invisible control characters must not enter a one-line PDF field.
const singleLine = (min: number, max: number, message: string) => z.string()
  .max(max * 2, message)
  .refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), message)
  .transform(value => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(min, message).max(max, message));

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < CONTRACT_LIMITS.year.min || year > CONTRACT_LIMITS.year.max || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** Shared validation; this module is safe to import in the owner-only form. */
export const contractDataSchema = z.object({
  date: z.string().refine(isCalendarDate, "Enter a valid date between 1900 and 2100."),
  fullName: singleLine(CONTRACT_LIMITS.fullName.min, CONTRACT_LIMITS.fullName.max, "Enter a full name (2–160 characters) without line breaks."),
  address: singleLine(CONTRACT_LIMITS.address.min, CONTRACT_LIMITS.address.max, "Enter an address (5–300 characters) without line breaks."),
}).strict();

export type ContractData = z.infer<typeof contractDataSchema>;
