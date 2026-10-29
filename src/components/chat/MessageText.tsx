import { Fragment, type ReactNode } from "react";
import { findTextLinks, normalizeRichTextContent, plainTextDocument, richTextPlainText, safeHttpUrl, type RichTextDocument, type RichTextRun } from "@/lib/rich-text";

const linkClass = "break-words underline decoration-current/70 underline-offset-[3px] transition-opacity hover:opacity-80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current [overflow-wrap:anywhere]";

function webLink(href: string, children: ReactNode, key: string) {
  return <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>{children}</a>;
}

function markedText(text: string, run: RichTextRun): ReactNode {
  let node: ReactNode = text;
  if (run.underline) node = <u>{node}</u>;
  if (run.italic) node = <em>{node}</em>;
  if (run.bold) node = <strong>{node}</strong>;
  return node;
}

function renderDocument(document: RichTextDocument): ReactNode {
  let position = 0;
  const runs = document.runs.map(run => {
    const from = position;
    position += run.text.length;
    return { run, from, to: position, href: run.href ? safeHttpUrl(run.href) : null };
  });
  // Match across style boundaries, so bolding half of a URL cannot split its destination.
  // Named links take priority and are never linkified a second time.
  const automatic = findTextLinks(richTextPlainText(document)).filter(link => !runs.some(run => run.href && run.from < link.to && run.to > link.from));
  const groups: Array<{ href: string | null; nodes: ReactNode[] }> = [];
  for (const item of runs) {
    const boundaries = new Set([item.from, item.to]);
    for (const link of automatic) {
      if (item.from < link.from && link.from < item.to) boundaries.add(link.from);
      if (item.from < link.to && link.to < item.to) boundaries.add(link.to);
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    for (let index = 1; index < ordered.length; index++) {
      const from = ordered[index - 1];
      const to = ordered[index];
      const href = item.href ?? automatic.find(link => link.from <= from && link.to >= to)?.href ?? null;
      const piece = <Fragment key={`${from}-${to}`}>{markedText(item.run.text.slice(from - item.from, to - item.from), item.run)}</Fragment>;
      const previous = groups.at(-1);
      if (previous && previous.href === href) previous.nodes.push(piece);
      else groups.push({ href, nodes: [piece] });
    }
  }
  return groups.map((group, index) => group.href ? webLink(group.href, group.nodes, `link-${index}`) : <Fragment key={index}>{group.nodes}</Fragment>);
}

/** Keep old messages readable and safely fall back to plain text if stored metadata is invalid. */
export function MessageText({ body, bodyRich }: { body: string; bodyRich?: unknown }) {
  let document: RichTextDocument | null = null;
  if (bodyRich !== undefined && bodyRich !== null) {
    try {
      const normalized = normalizeRichTextContent(body, bodyRich, Math.max(4000, body.length));
      document = normalized.bodyRich;
    } catch {
      // Text is still escaped by React. Invalid/legacy metadata never becomes HTML.
    }
  }
  return <>{renderDocument(document ?? plainTextDocument(body))}</>;
}
