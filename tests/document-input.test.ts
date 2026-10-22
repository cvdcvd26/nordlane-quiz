import { describe, expect, it } from "vitest";
import { documentDateToIso, parseDocumentInput } from "@/lib/document-input";

describe("document detail list", () => {
  const data = { date: "2026-10-22", fullName: "Jan Kowalski", address: "ul. Długa 10, 00-001 Warszawa" };

  it("reads labelled Polish, Russian and English lists in any order", () => {
    for (const text of [
      "Data: 22.10.2026\nImię i nazwisko: Jan Kowalski\nAdres: ul. Długa 10, 00-001 Warszawa",
      "Имя: Jan Kowalski\nАдрес: ul. Długa 10, 00-001 Warszawa\nДата: 2026-10-22",
      "Address: ul. Długa 10, 00-001 Warszawa\nDate: 22/10/2026\nFull name: Jan Kowalski",
    ]) expect(parseDocumentInput(text)).toEqual({ ok: true, data });
  });

  it("supports an unlabelled date, full name and address without guessing their order", () => {
    expect(parseDocumentInput("22.10.2026\nJan Kowalski\nul. Długa 10, 00-001 Warszawa")).toEqual({ ok: true, data });
    expect(parseDocumentInput("Jan Kowalski\n22.10.2026\nul. Długa 10, 00-001 Warszawa")).toEqual({ ok: false, reason: "invalid" });
  });

  it("handles blank lines, Windows line endings and numbered or bulleted lists", () => {
    expect(parseDocumentInput("\r\n1. Data: 22.10.2026\r\n\r\n2. Imię i nazwisko: Jan Kowalski\r\n3. Adres: ul. Długa 10, 00-001 Warszawa\r\n")).toEqual({ ok: true, data });
    expect(parseDocumentInput("• Date: 22-10-2026\n• Full name: Jan Kowalski\n• Address: ul. Długa 10, 00-001 Warszawa")).toEqual({ ok: true, data });
  });

  it("normalises unicode and spaces without removing Polish letters", () => {
    const result = parseDocumentInput("Дата: 22.10.2026\nИмя:  Łucja   Żuk \nАдрес: ul. Długa   10, Warszawa");
    expect(result).toEqual({ ok: true, data: { date: "2026-10-22", fullName: "Łucja Żuk", address: "ul. Długa 10, Warszawa" } });
  });

  it("rejects repeated or unknown fields instead of silently overwriting them", () => {
    expect(parseDocumentInput("Date: 22.10.2026\nДата: 23.10.2026\nName: Jan Kowalski")).toEqual({ ok: false, reason: "duplicate" });
    expect(parseDocumentInput("Date: 22.10.2026\nPerson: Jan Kowalski\nAddress: Warszawa")).toEqual({ ok: false, reason: "format" });
  });

  it("rejects partial lists, mixed labels and extra rows", () => {
    for (const text of [
      "Date: 22.10.2026\nName: Jan Kowalski",
      "Date: 22.10.2026\nJan Kowalski\nWarszawa",
      "22.10.2026\nJan Kowalski\nWarszawa\nSomething else",
    ]) expect(parseDocumentInput(text)).toEqual({ ok: false, reason: "format" });
    expect(parseDocumentInput("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects invalid calendar dates, control characters and values outside the shared limits", () => {
    for (const date of ["31.02.2026", "29.02.2025", "22.10.1899", "22.10.2101", "2026-13-01"]) {
      expect(parseDocumentInput(`${date}\nJan Kowalski\nWarszawa`)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(parseDocumentInput("29.02.2024\nJan Kowalski\nWarszawa")).toMatchObject({ ok: true });
    expect(parseDocumentInput(`22.10.2026\nJan\u200b Kowalski\nWarszawa`)).toEqual({ ok: false, reason: "invalid" });
    expect(parseDocumentInput(`22.10.2026\n${"A".repeat(161)}\nWarszawa`)).toEqual({ ok: false, reason: "invalid" });
    expect(parseDocumentInput("A".repeat(1601))).toEqual({ ok: false, reason: "format" });
  });
});

describe("pasted date format", () => {
  it("converts day-first dates and leaves ISO dates intact", () => {
    expect(documentDateToIso("1.2.2026")).toBe("2026-02-01");
    expect(documentDateToIso(" 2026-10-22 ")).toBe("2026-10-22");
    expect(documentDateToIso("22/10-2026")).toBe("");
    expect(documentDateToIso("10/22/26")).toBe("");
  });
});
