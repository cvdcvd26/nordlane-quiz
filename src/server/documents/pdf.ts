import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { contractDataSchema, type ContractData } from "@/lib/documents";
import { badRequest } from "@/server/errors";
import { loadContractTemplate } from "./template";

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 52;
const WIDTH = A4.width - MARGIN * 2;
const BODY_SIZE = 10.2;
const LEADING = 15;
const INK = rgb(0.1, 0.12, 0.14);
const MUTED = rgb(0.4, 0.43, 0.46);
const RULE = rgb(0.79, 0.81, 0.82);
const assetsDirectory = path.join(process.cwd(), "src/server/documents/assets");

// Only immutable assets are cached. Candidate data and finished PDFs are never cached.
let assets: Promise<Buffer[]> | undefined;
function loadAssets() {
  if (!assets) assets = Promise.all([
    readFile(path.join(assetsDirectory, "NotoSans-Regular.ttf")),
    readFile(path.join(assetsDirectory, "NotoSans-Bold.ttf")),
  ]).catch(error => { assets = undefined; throw error; });
  return assets;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/u)) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
    if (current) lines.push(current);
    current = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(current + character, size) > width && current) {
        lines.push(current);
        current = "";
      }
      current += character;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** A fresh, typeset document; no text is painted over the original candidate's data. */
export async function generateContractPdf(input: ContractData): Promise<Uint8Array> {
  const data = contractDataSchema.parse(input);
  const [[regularBytes, boldBytes], template] = await Promise.all([loadAssets(), loadContractTemplate()]);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [regular, bold, signature] = await Promise.all([
    document.embedFont(regularBytes, { subset: true }),
    document.embedFont(boldBytes, { subset: true }),
    document.embedPng(template.signature),
  ]);
  const supported = new Set(regular.getCharacterSet());
  if (Array.from(`${data.fullName}${data.address}`).some(character => !supported.has(character.codePointAt(0)!)))
    throw badRequest("The name or address contains characters that this document font cannot display.", "document_characters");

  document.setTitle("Umowa o świadczenie usług");
  document.setAuthor("Alleybizcom Sp. z o.o.");
  document.setCreator("AlleyBiz document generator");
  document.setSubject("Umowa o świadczenie usług");
  document.setKeywords([]);
  let page: PDFPage;
  let cursor = 0;
  const newPage = () => {
    page = document.addPage([A4.width, A4.height]);
    cursor = A4.height - 52;
    if (document.getPageCount() > 1) {
      page.drawText("UMOWA O ŚWIADCZENIE USŁUG", { x: MARGIN, y: cursor, size: 8, font: bold, color: MUTED });
      page.drawText("Alleybizcom Sp. z o.o.", { x: A4.width - MARGIN - regular.widthOfTextAtSize("Alleybizcom Sp. z o.o.", 8), y: cursor, size: 8, font: regular, color: MUTED });
      page.drawLine({ start: { x: MARGIN, y: cursor - 12 }, end: { x: A4.width - MARGIN, y: cursor - 12 }, thickness: 0.5, color: RULE });
      cursor -= 36;
    }
  };
  const ensure = (height: number) => { if (cursor - height < 57) newPage(); };
  const centered = (text: string, size: number, font: PDFFont = regular, leading = size * 1.45, width = WIDTH) => {
    for (const line of wrap(text, font, size, width)) {
      ensure(leading);
      page.drawText(line, { x: (A4.width - font.widthOfTextAtSize(line, size)) / 2, y: cursor, font, size, color: INK });
      cursor -= leading;
    }
  };
  newPage();
  centered("UMOWA O ŚWIADCZENIE USŁUG", 17, bold);
  cursor -= 5;
  const [year, month, day] = data.date.split("-");
  centered(`zawarta w dniu ${day}.${month}.${year} r. w Lublinie, pomiędzy:`, 10.2);
  cursor -= 23;
  centered("Zamawiającym:", 10.2, bold);
  centered("Alleybizcom Spółka z ograniczoną odpowiedzialnością z siedzibą przy", 10.2);
  centered("Al. Generała Władysława Sikorskiego 20, 59-300 Lublin", 10.2);
  cursor -= 5;
  centered("NIP: 7123509615  |  KRS: 0001227235  |  REGON: 544149844", 9.2);
  centered("reprezentowaną przez: Ewę Dąbrowską - Prezesa Zarządu", 10.2);
  cursor -= 8;
  centered("a", 10.2);
  cursor -= 8;
  centered("Wykonawcą:", 10.2, bold);
  centered(data.fullName, 11, bold, 16);
  centered(data.address, 10.2, regular, 15, WIDTH - 20);
  cursor -= 12;
  centered("zwanymi dalej łącznie „Stronami”, a każda z osobna „Stroną”.", 10.2);
  cursor -= 7;

  for (const block of template.blocks) {
    if (block.type === "heading") {
      ensure(70);
      cursor -= 15;
      centered(`${block.label}   ${block.text}`, 11.5, bold, 18);
      page!.drawLine({ start: { x: MARGIN, y: cursor + 3 }, end: { x: A4.width - MARGIN, y: cursor + 3 }, thickness: 0.55, color: RULE });
      cursor -= 13;
      continue;
    }
    const sub = block.type === "subclause";
    const labelX = MARGIN + (sub ? 20 : 0);
    const textX = labelX + 19;
    const lines = wrap(block.text.replace(/[–—]/g, "-"), regular, BODY_SIZE, A4.width - MARGIN - textX);
    const height = lines.length * LEADING + (sub ? 4 : 8);
    ensure(height);
    page!.drawText(block.label, { x: labelX, y: cursor, size: BODY_SIZE, font: regular, color: INK });
    for (const line of lines) {
      page!.drawText(line, { x: textX, y: cursor, size: BODY_SIZE, font: regular, color: INK });
      cursor -= LEADING;
    }
    cursor -= sub ? 4 : 8;
  }

  const signatureName = wrap(data.fullName, regular, 10.2, 207);
  const signatureHeight = 94 + Math.max(signatureName.length, 2) * 15;
  ensure(signatureHeight + 22);
  cursor -= 22;
  const columns = [MARGIN, A4.width / 2 + 27];
  const columnWidth = A4.width / 2 - MARGIN - 27;
  const signatureWidth = Math.min(160, columnWidth - 20);
  page!.drawImage(signature, { x: columns[0] + (columnWidth - signatureWidth) / 2, y: cursor - 42, width: signatureWidth, height: signatureWidth * signature.height / signature.width });
  const lineY = cursor - 48;
  columns.forEach(x => page!.drawLine({ start: { x, y: lineY }, end: { x: x + columnWidth, y: lineY }, thickness: 0.65, color: INK }));
  const signatureText = (text: string, column: number, y: number, font: PDFFont = regular) => {
    page!.drawText(text, { x: columns[column] + (columnWidth - font.widthOfTextAtSize(text, 10.2)) / 2, y, size: 10.2, font, color: INK });
  };
  signatureText("Zamawiający", 0, lineY - 20, bold);
  signatureText("Wykonawca", 1, lineY - 20, bold);
  // Keep the supplied signature image unmodified; the candidate's signing line remains empty.
  const companyName = wrap("Ewa Dąbrowska - Prezes Zarządu", regular, 10.2, columnWidth);
  companyName.forEach((line, i) => signatureText(line, 0, lineY - 37 - i * 15));
  signatureText("Alleybizcom Sp. z o.o.", 0, lineY - 37 - companyName.length * 15);
  signatureName.forEach((line, i) => signatureText(line, 1, lineY - 37 - i * 15));

  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: A4.width - MARGIN, y: 40 }, thickness: 0.5, color: RULE });
    current.drawText("Alleybizcom Sp. z o.o.", { x: MARGIN, y: 26, size: 8, font: regular, color: MUTED });
    const number = `${index + 1} / ${pages.length}`;
    current.drawText(number, { x: A4.width - MARGIN - regular.widthOfTextAtSize(number, 8), y: 26, size: 8, font: regular, color: MUTED });
  });
  return document.save();
}
