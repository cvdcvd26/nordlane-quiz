import { LinkifyIt } from "linkify-it";
import { z } from "zod";

/** A small, versioned set of inline marks. No HTML is stored or interpreted. */
export const RICH_TEXT_LIMITS = { runs: 256, bytes: 16 * 1024, href: 2048 } as const;

/** Only ordinary web links can be made interactive, including in pasted/editor content. */
export function safeHttpUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > RICH_TEXT_LIMITS.href || /[\u0000-\u0020\u007f]/u.test(trimmed)) return null;
  const value = /^www\./iu.test(trimmed) ? `https://${trimmed}` : trimmed;
  if (!/^https?:\/\//iu.test(value)) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > RICH_TEXT_LIMITS.href) return null;
    return url.href;
  } catch {
    return null;
  }
}

const richTextRunSchema = z.object({
  text: z.string().min(1).max(4000),
  bold: z.literal(true).optional(),
  italic: z.literal(true).optional(),
  underline: z.literal(true).optional(),
  href: z.string().max(RICH_TEXT_LIMITS.href).refine(value => safeHttpUrl(value) !== null, "Invalid web link.").optional(),
}).strict();

export const richTextSchema = z.object({
  version: z.literal(1),
  runs: z.array(richTextRunSchema).max(RICH_TEXT_LIMITS.runs),
}).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > RICH_TEXT_LIMITS.bytes) {
    ctx.addIssue({ code: "custom", message: "Formatted text is too large." });
  }
});

export type RichTextDocument = z.infer<typeof richTextSchema>;
export type RichTextRun = RichTextDocument["runs"][number];

export const richTextPlainText = (value: RichTextDocument): string => value.runs.map(run => run.text).join("");

/** Drafts retain their spaces and newlines until the existing send/save operation trims them. */
export function plainTextDocument(text: string): RichTextDocument {
  return { version: 1, runs: text ? [{ text }] : [] };
}

function sameMarks(a: RichTextRun, b: RichTextRun): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.href === b.href;
}

/** Validate plain/rich agreement and trim both representations without losing mark positions. */
export function normalizeRichTextContent(body: string, bodyRich?: unknown, maxLength = 4000): { body: string; bodyRich: RichTextDocument | null } {
  const normalizedBody = z.string().trim().max(maxLength).parse(body);
  if (bodyRich === undefined || bodyRich === null) return { body: normalizedBody, bodyRich: null };
  const document = richTextSchema.parse(bodyRich);
  const plain = richTextPlainText(document);
  if (plain.trim() !== normalizedBody) {
    throw new z.ZodError([{ code: "custom", path: ["bodyRich"], message: "Formatted text does not match the message." }]);
  }
  const start = plain.length - plain.trimStart().length;
  const end = plain.trimEnd().length;
  let offset = 0;
  const runs: RichTextRun[] = [];
  for (const run of document.runs) {
    const from = Math.max(0, start - offset);
    const to = Math.min(run.text.length, end - offset);
    offset += run.text.length;
    if (from >= to) continue;
    const next: RichTextRun = { text: run.text.slice(from, to) };
    if (run.bold) next.bold = true;
    if (run.italic) next.italic = true;
    if (run.underline) next.underline = true;
    if (run.href) next.href = safeHttpUrl(run.href)!;
    const previous = runs.at(-1);
    if (previous && sameMarks(previous, next)) previous.text += next.text;
    else runs.push(next);
  }
  const formatted = runs.some(run => run.bold || run.italic || run.underline || run.href);
  return { body: normalizedBody, bodyRich: formatted ? richTextSchema.parse({ version: 1, runs }) : null };
}

export type TextLink = { from: number; to: number; text: string; href: string };
const webLinks = new LinkifyIt().set({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false });

/** Linkify explicit HTTP(S) and www links; bare domains and emails remain ordinary text. */
export function findTextLinks(text: string): TextLink[] {
  const result: TextLink[] = [];
  for (const match of webLinks.match(text) ?? []) {
    if (!/^(?:https?:\/\/|www\.)/iu.test(match.raw)) continue;
    // The recognizer may stop at the first ':' or '@' and return only the apparent
    // host from a user:password@host token. Inspect its original authority too,
    // rather than accidentally making that misleading partial token interactive.
    const prefixLength = match.raw.match(/^https?:\/\//iu)?.[0].length ?? 0;
    const remainder = text.slice(match.index + prefixLength);
    const authorityEnd = remainder.search(/[\/\\?#\s<>"'`]/u);
    const authority = authorityEnd === -1 ? remainder : remainder.slice(0, authorityEnd);
    if (text[match.index - 1] === "@" || authority.includes("@")) continue;
    const href = safeHttpUrl(match.raw);
    if (href) result.push({ from: match.index, to: match.lastIndex, text: match.raw, href });
  }
  return result;
}
