import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { PNG } from "./helpers";
import { generateContractPdf } from "@/server/documents/pdf";

vi.mock("@/server/documents/template", () => ({
  loadContractTemplate: async () => ({
    blocks: [{ type: "heading", label: "§ 1", text: "Przedmiot umowy" },
      { type: "clause", label: "1.", text: "Przykładowa treść dokumentu." }],
    signature: PNG,
  }),
}));

const input = { date: "2028-02-29", fullName: "Łucja Żółkiewska", address: "ul. Przykładowa 12/3, 00-001 Warszawa" };
let drawn: Array<{ text: string; x: number; y: number; width: number }>;
beforeEach(() => {
  drawn = [];
  const original = PDFPage.prototype.drawText;
  vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options = {}) {
    drawn.push({ text, x: options.x ?? 0, y: options.y ?? 0, width: options.font?.widthOfTextAtSize(text, options.size ?? 12) ?? 0 });
    return original.call(this, text, options);
  });
});
afterEach(() => vi.restoreAllMocks());

describe("contract PDF generation", () => {
  it("produces a valid static A4 PDF with date once, Polish name twice, and address once", async () => {
    const bytes = await generateContractPdf(input);
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getPages()[0].getWidth()).toBeCloseTo(595.28);
    expect(document.getForm().getFields()).toHaveLength(0);
    expect(drawn.filter(row => row.text === input.fullName)).toHaveLength(2);
    expect(drawn.filter(row => row.text === input.address)).toHaveLength(1);
    expect(drawn.filter(row => row.text.includes("29.02.2028"))).toHaveLength(1);
    const title = drawn.find(row => row.text === "UMOWA O ŚWIADCZENIE USŁUG")!;
    const date = drawn.find(row => row.text.includes("29.02.2028"))!;
    const label = drawn.find(row => row.text === "Wykonawcą: ")!;
    const firstName = drawn.find(row => row.text === input.fullName)!;
    expect(title.x).toBe(52);
    expect(date.x).toBe(52);
    expect(label.x).toBe(52);
    expect(firstName.y).toBe(label.y);
    expect(firstName.x).toBeGreaterThan(label.x);
  });

  it("wraps long names and addresses while keeping every drawn line inside the page margins", async () => {
    await generateContractPdf({ ...input, fullName: "Aleksandra ".repeat(14).trim(), address: "DługaNazwaUlicy".repeat(20) });
    expect(drawn.length).toBeGreaterThan(25);
    for (const row of drawn) {
      expect(row.x, row.text).toBeGreaterThanOrEqual(51.9);
      expect(row.x + row.width, row.text).toBeLessThanOrEqual(543.4);
      expect(row.y, row.text).toBeGreaterThanOrEqual(25);
      expect(row.y, row.text).toBeLessThanOrEqual(790);
    }
  });

  it("does not carry candidate data into the next generated document", async () => {
    await generateContractPdf(input);
    drawn = [];
    await generateContractPdf({ ...input, fullName: "Jan Nowak", address: "ul. Nowa 10, Kraków" });
    expect(drawn.filter(row => row.text === "Jan Nowak")).toHaveLength(2);
    expect(drawn.some(row => row.text.includes(input.fullName) || row.text.includes(input.address))).toBe(false);
  });

  it("rejects unsupported glyphs rather than generating an unreadable document", async () => {
    await expect(generateContractPdf({ ...input, fullName: "Anna 😀" })).rejects.toMatchObject({ status: 400, code: "document_characters" });
  });
});
