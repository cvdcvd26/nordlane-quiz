/** Contact helpers shared by the browser (mask, validation) and the server (validation, normalisation). */

/** Extracts the 9-digit Polish national number from any input: "+48 600…", "0048…", "48600…", "600-123-456". */
export function nationalDigits(raw: string) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0048")) d = d.slice(4);
  else if (d.startsWith("48") && d.length > 9) d = d.slice(2);
  return d.slice(0, 9);
}

/** Display format: +48 XXX XXX XXX */
export function formatPhone(digits: string) {
  if (!digits) return "";
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean);
  return `+48 ${parts.join(" ")}`;
}

export const isValidPhone = (digits: string) => /^[1-9]\d{8}$/.test(digits);

/** Stored format (E.164): +48XXXXXXXXX, or null if invalid. */
export const normalizePhone = (raw: string) => {
  if (!/^\s*\+?[\d\s().-]+\s*$/.test(raw)) return null;
  let d = raw.replace(/\D/g, "");
  if (/^\s*\+/.test(raw)) {
    if (!d.startsWith("48") || d.length !== 11) return null;
    d = d.slice(2);
  } else if (d.startsWith("0048")) d = d.slice(4);
  else if (d.startsWith("48") && d.length === 11) d = d.slice(2);
  return isValidPhone(d) ? `+48${d}` : null;
};

/**
 * Accepts "nick", "@nick", "t.me/nick", "https://t.me/nick".
 * Returns "@nick", null for empty input, or false if invalid.
 */
export function normalizeTelegram(raw: string): string | null | false {
  let v = String(raw || "").trim();
  if (!v) return null;
  v = v
    .replace(/^(https?:\/\/)?(www\.)?(t|telegram)\.me\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v) ? `@${v}` : false;
}

/**
 * Re-formats the phone field while typing or pasting and returns the new caret position,
 * so editing in the middle of the number keeps working.
 */
export function maskPhoneInput(value: string, caret: number) {
  const all = value.replace(/\D/g, "");
  let offset: number;
  if (value.trim().startsWith("+")) offset = all.startsWith("48") ? 2 : all === "4" ? 1 : 0;
  else offset = all.startsWith("0048") ? 4 : all.startsWith("48") && all.length > 9 ? 2 : 0;
  const digits = all.slice(offset, offset + 9);
  const digitsBefore = Math.max(0, value.slice(0, caret).replace(/\D/g, "").length - offset);
  const formatted = formatPhone(digits);

  let pos = formatted.length;
  if (digitsBefore < digits.length) {
    if (digitsBefore === 0) pos = 4;
    else {
      let seen = 0;
      for (let i = 4; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) seen++;
        if (seen === digitsBefore) {
          pos = i + 1;
          break;
        }
      }
    }
  }
  return { value: formatted, caret: pos, digits };
}
