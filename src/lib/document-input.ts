import { contractDataSchema, type ContractData } from "./documents";

type Field = keyof ContractData;
export type DocumentInputError = "empty" | "format" | "duplicate" | "invalid";
export type DocumentInputResult = { ok: true; data: ContractData } | { ok: false; reason: DocumentInputError };

const aliases: Record<string, Field> = {
  data: "date", date: "date", дата: "date",
  "imie i nazwisko": "fullName", "imie nazwisko": "fullName", imie: "fullName",
  name: "fullName", "full name": "fullName", fullname: "fullName",
  имя: "fullName", фио: "fullName", "имя и фамилия": "fullName", "фамилия и имя": "fullName", піб: "fullName",
  adres: "address", address: "address", адрес: "address", адреса: "address",
};

function labelKey(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/gu, " ");
}

/** The pasted day-first date is converted without Date's timezone or rollover behavior. */
export function documentDateToIso(value: string): string {
  const date = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const match = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/.exec(date);
  return match ? `${match[4]}-${match[3].padStart(2, "0")}-${match[1].padStart(2, "0")}` : "";
}

/** Parse only an explicit three-field list; ambiguous or duplicate values never overwrite the form. */
export function parseDocumentInput(text: string): DocumentInputResult {
  if (!text.trim()) return { ok: false, reason: "empty" };
  if (text.length > 1600) return { ok: false, reason: "format" };
  const lines = text.split(/\r?\n/u).map(line => line.replace(/^\s*(?:[-*•]\s+|\d{1,2}[.)]\s+)/u, "").trim()).filter(Boolean);
  if (lines.length !== 3) return { ok: false, reason: "format" };

  const labelled = lines.map(line => /^([^:=]+)\s*[:=]\s*(.*)$/u.exec(line));
  let candidate: Record<Field, string>;
  if (labelled.every(Boolean)) {
    candidate = { date: "", fullName: "", address: "" };
    const seen = new Set<Field>();
    for (const match of labelled) {
      const key = aliases[labelKey(match![1])];
      if (!key) return { ok: false, reason: "format" };
      if (seen.has(key)) return { ok: false, reason: "duplicate" };
      seen.add(key);
      candidate[key] = match![2];
    }
  } else if (labelled.every(match => match === null)) {
    candidate = { date: lines[0], fullName: lines[1], address: lines[2] };
  } else {
    return { ok: false, reason: "format" };
  }
  candidate.date = documentDateToIso(candidate.date);
  const validated = contractDataSchema.safeParse(candidate);
  return validated.success ? { ok: true, data: validated.data } : { ok: false, reason: "invalid" };
}
