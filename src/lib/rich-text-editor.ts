import type { JSONContent } from "@tiptap/core";
import { richTextPlainText, safeHttpUrl, type RichTextDocument } from "./rich-text";

export type RichTextValue = { body: string; bodyRich: RichTextDocument | null };
type Run = RichTextDocument["runs"][number];

function marksFor(run: Run): NonNullable<JSONContent["marks"]> {
  const marks: NonNullable<JSONContent["marks"]> = [];
  if (run.bold) marks.push({ type: "bold" });
  if (run.italic) marks.push({ type: "italic" });
  if (run.underline) marks.push({ type: "underline" });
  const href = run.href && safeHttpUrl(run.href);
  if (href) marks.push({ type: "link", attrs: { href } });
  return marks;
}

function runsFor(value: RichTextValue): Run[] {
  return value.bodyRich && richTextPlainText(value.bodyRich) === value.body
    ? value.bodyRich.runs
    : value.body ? [{ text: value.body }] : [];
}

/** Flat, validated message data becomes only paragraph/text/hard-break nodes, never HTML. */
export function richTextToEditorJson(value: RichTextValue): JSONContent {
  const content: JSONContent[] = [];
  let paragraph: JSONContent = { type: "paragraph", content: [] };
  for (const run of runsFor(value)) {
    const parts = run.text.split("\n");
    for (let index = 0; index < parts.length; index++) {
      if (index > 0) { content.push(paragraph); paragraph = { type: "paragraph", content: [] }; }
      if (parts[index]) paragraph.content!.push({ type: "text", text: parts[index], marks: marksFor(run) });
    }
  }
  content.push(paragraph);
  return { type: "doc", content };
}

function sameMarks(a: Run, b: Run) {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.href === b.href;
}

function appendRun(runs: Run[], run: Run) {
  if (!run.text) return;
  const previous = runs.at(-1);
  if (previous && sameMarks(previous, run)) previous.text += run.text;
  else runs.push(run);
}

function valueFromRuns(runs: Run[]): RichTextValue {
  const body = runs.map(run => run.text).join("");
  return { body, bodyRich: runs.some(run => run.bold || run.italic || run.underline || run.href)
    ? { version: 1, runs } : null };
}

/** Preserve draft whitespace. Trimming belongs to the send/save boundary, not typing. */
export function editorJsonToRichText(json: JSONContent): RichTextValue {
  const runs: Run[] = [];
  const paragraphs = (json.content ?? []).filter(node => node.type === "paragraph");
  for (let index = 0; index < paragraphs.length; index++) {
    if (index) appendRun(runs, { text: "\n" });
    for (const node of paragraphs[index].content ?? []) {
      if (node.type === "hardBreak") { appendRun(runs, { text: "\n" }); continue; }
      if (node.type !== "text" || !node.text) continue;
      const run: Run = { text: node.text };
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") run.bold = true;
        if (mark.type === "italic") run.italic = true;
        if (mark.type === "underline") run.underline = true;
        if (mark.type === "link" && typeof mark.attrs?.href === "string") {
          const href = safeHttpUrl(mark.attrs.href);
          if (href) run.href = href;
        }
      }
      appendRun(runs, run);
    }
  }
  return valueFromRuns(runs);
}

/** Appending a template retains both the existing draft's and the template's marks. */
export function appendRichTextTemplate(draft: RichTextValue, template: RichTextValue): RichTextValue {
  if (!draft.body.trim()) return { body: template.body, bodyRich: template.bodyRich };
  const end = draft.body.trimEnd().length;
  const runs: Run[] = [];
  let remaining = end;
  for (const source of runsFor(draft)) {
    if (!remaining) break;
    const text = source.text.slice(0, remaining);
    appendRun(runs, { ...source, text });
    remaining -= text.length;
  }
  appendRun(runs, { text: "\n\n" });
  for (const run of runsFor(template)) appendRun(runs, { ...run });
  return valueFromRuns(runs);
}
