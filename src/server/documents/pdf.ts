import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { contractDataSchema, type ContractData } from "@/lib/documents";
import { brand, company } from "@/config/brand";
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
    readFile(path.join(assetsDirectory, "Allura-Regular.ttf")),
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
  const [[regularBytes, boldBytes, calligraphicBytes], template] = await Promise.all([loadAssets(), loadContractTemplate()]);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [regular, bold, calligraphic] = await Promise.all([
    document.embedFont(regularBytes, { subset: true }),
    document.embedFont(boldBytes, { subset: true }),
    // Allura uses contextual glyph substitutions; keep the complete font so those glyphs render in PDF readers.
    document.embedFont(calligraphicBytes, { subset: false }),
  ]);
  const supported = new Set(regular.getCharacterSet());
  if (Array.from(`${data.fullName}${data.address}`).some(character => !supported.has(character.codePointAt(0)!)))
    throw badRequest("The name or address contains characters that this document font cannot display.", "document_characters");

  document.setTitle("Umowa o świadczenie usług");
  document.setAuthor(company.name);
  document.setCreator(`${brand.name} document generator`);
  document.setSubject("Umowa o świadczenie usług");
  document.setKeywords([]);
  let page: PDFPage;
  let cursor = 0;
  const newPage = () => {
    page = document.addPage([A4.width, A4.height]);
    cursor = A4.height - 52;
    if (document.getPageCount() > 1) {
      page.drawText("UMOWA O ŚWIADCZENIE USŁUG", { x: MARGIN, y: cursor, size: 8, font: bold, color: MUTED });
      page.drawText(company.name, { x: A4.width - MARGIN - regular.widthOfTextAtSize(company.name, 8), y: cursor, size: 8, font: regular, color: MUTED });
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
  const left = (text: string, size: number, font: PDFFont = regular, leading = size * 1.45) => {
    for (const line of wrap(text, font, size, WIDTH)) {
      ensure(leading);
      page.drawText(line, { x: MARGIN, y: cursor, font, size, color: INK });
      cursor -= leading;
    }
  };
  newPage();
  centered("UMOWA O ŚWIADCZENIE USŁUG", 17, bold, 19.2);
  const [year, month, day] = data.date.split("-");
  centered(`zawarta w dniu ${day}.${month}.${year} r. w Gdyni, pomiędzy:`, 10.2);
  centered(`Współpraca B2B • ${company.name}`, 9.2, regular, 14);
  cursor -= 14;
  const companyLabel = "Zamawiającym: ";
  const companyLabelWidth = bold.widthOfTextAtSize(companyLabel, 10.2);
  const companyLines = wrap(`${company.name} z siedzibą przy ${company.address}`, regular, 10.2, WIDTH - companyLabelWidth);
  page!.drawText(companyLabel, { x: MARGIN, y: cursor, font: bold, size: 10.2, color: INK });
  companyLines.forEach((line, index) => {
    page!.drawText(line, { x: MARGIN + (index === 0 ? companyLabelWidth : 0), y: cursor, font: regular, size: 10.2, color: INK });
    cursor -= 15;
  });
  cursor -= 5;
  left(`NIP: ${company.nip}  |  KRS: ${company.krs}  |  REGON: ${company.regon}`, 9.2);
  left(`reprezentowaną przez: ${company.representativeAccusative} - ${company.representativeRole}`, 10.2);
  cursor -= 8;
  centered("a", 10.2);
  cursor -= 8;
  const [startYear, startMonth, startDay] = data.startDate.split("-");
  const details = [
    ["Wykonawcą: ", data.fullName],
    ["PESEL Wykonawcy: ", data.pesel],
    ["Adres Wykonawcy: ", data.address],
    ["Data rozpoczęcia: ", `${startDay}.${startMonth}.${startYear}`],
  ];
  const labelWidth = 126;
  const rowPadding = 7;
  for (const [label, value] of details) {
    const lines = wrap(value, regular, 10.2, WIDTH - labelWidth - rowPadding * 2);
    const rowHeight = Math.max(1, lines.length) * 15 + rowPadding * 2;
    ensure(rowHeight);
    page!.drawRectangle({ x: MARGIN + labelWidth, y: cursor - rowHeight + 11, width: WIDTH - labelWidth, height: rowHeight, color: rgb(1, 0.975, 0.89) });
    page!.drawText(label, { x: MARGIN, y: cursor - rowPadding, font: bold, size: 10.2, color: INK });
    lines.forEach((line, index) => page!.drawText(line, { x: MARGIN + labelWidth + rowPadding, y: cursor - rowPadding - index * 15, font: regular, size: 10.2, color: INK }));
    cursor -= rowHeight;
    page!.drawLine({ start: { x: MARGIN, y: cursor + 11 }, end: { x: A4.width - MARGIN, y: cursor + 11 }, thickness: 0.4, color: RULE });
  }
  cursor -= 10;
  left(`Umowę zawierają ITSOLUTTIONSPOL Spółka z ograniczoną odpowiedzialnością, KRS ${company.krs}, NIP ${company.nip}, REGON ${company.regon}, z siedzibą przy ul. Morskiej 10, 81-323 Gdynia („Zamawiający”), oraz osoba fizyczna wskazana w tabeli („Wykonawca”). Tabela stanowi część umowy.`, 9.2, regular, 13.5);
  cursor -= 8;
  left("Dane potrzebne do rozpoczęcia współpracy wpisujemy w żółte pola. Przy podpisaniu umowy Strony wymieniają adresy e-mail do kontaktu, zgłaszania problemów i doręczania wypowiedzeń.", 9.2, regular, 13.5);
  cursor -= 2;

  for (const block of template.blocks) {
    if (block.type === "heading") {
      ensure(70);
      cursor -= 15;
      centered(`${block.label}   ${block.text}`.trim(), 11.5, bold, 18);
      page!.drawLine({ start: { x: MARGIN, y: cursor + 3 }, end: { x: A4.width - MARGIN, y: cursor + 3 }, thickness: 0.55, color: RULE });
      cursor -= 13;
      continue;
    }
    const sub = block.type === "subclause";
    const paragraph = block.type === "paragraph";
    const labelX = MARGIN + (sub ? 20 : 0);
    const textX = labelX + (paragraph ? 0 : 19);
    const lines = wrap(block.text.replace(/[–—]/g, "-"), regular, BODY_SIZE, A4.width - MARGIN - textX);
    const height = lines.length * LEADING + (sub ? 4 : 8);
    ensure(height);
    if (!paragraph) page!.drawText(block.label, { x: labelX, y: cursor, size: BODY_SIZE, font: regular, color: INK });
    for (const line of lines) {
      page!.drawText(line, { x: textX, y: cursor, size: BODY_SIZE, font: regular, color: INK });
      cursor -= LEADING;
    }
    cursor -= sub ? 4 : 8;
  }

  const signatureName = wrap(data.fullName, regular, 10.2, 207);
  const signatureHeight = 106 + Math.max(signatureName.length, 3) * 15;
  ensure(signatureHeight + 22);
  cursor -= 22;
  const columns = [MARGIN, A4.width / 2 + 27];
  const columnWidth = A4.width / 2 - MARGIN - 27;
  const lineY = cursor - 48;
  columns.forEach(x => page!.drawLine({ start: { x, y: lineY }, end: { x: x + columnWidth, y: lineY }, thickness: 0.65, color: INK }));
  const signatureText = (text: string, column: number, y: number, font: PDFFont = regular) => {
    page!.drawText(text, { x: columns[column] + (columnWidth - font.widthOfTextAtSize(text, 10.2)) / 2, y, size: 10.2, font, color: INK });
  };
  signatureText("Zamawiający", 0, lineY - 20, bold);
  signatureText("Wykonawca", 1, lineY - 20, bold);
  // Decorative typeset name beneath a blank signing line, never an applied handwritten signature.
  const nameSize = Math.min(23, 23 * (columnWidth - 4) / calligraphic.widthOfTextAtSize(company.representative, 23));
  page!.drawText(company.representative, { x: columns[0] + (columnWidth - calligraphic.widthOfTextAtSize(company.representative, nameSize)) / 2, y: lineY - 46, size: nameSize, font: calligraphic, color: INK });
  signatureText(company.representativeRole, 0, lineY - 64);
  const companyName = wrap(company.name, regular, 10.2, columnWidth);
  companyName.forEach((line, i) => signatureText(line, 0, lineY - 81 - i * 15));
  signatureName.forEach((line, i) => signatureText(line, 1, lineY - 37 - i * 15));

  const pages = document.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: A4.width - MARGIN, y: 40 }, thickness: 0.5, color: RULE });
    current.drawText(company.name, { x: MARGIN, y: 26, size: 8, font: regular, color: MUTED });
    const number = `${index + 1} / ${pages.length}`;
    current.drawText(number, { x: A4.width - MARGIN - regular.widthOfTextAtSize(number, 8), y: 26, size: 8, font: regular, color: MUTED });
  });
  return document.save();
}
