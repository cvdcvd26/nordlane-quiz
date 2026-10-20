import { describe, it, expect } from "vitest";
import { maskPhoneInput, nationalDigits, normalizePhone, normalizeTelegram } from "@/lib/contact";

describe("Polish phone mask", () => {
  it("formats while typing", () => {
    expect(maskPhoneInput("+48 6001", 8).value).toBe("+48 600 1");
    expect(maskPhoneInput("+48 600 123 4567", 16).value).toBe("+48 600 123 456");
  });
  it("handles pasted numbers in any format", () => {
    for (const raw of ["600123456", "+48600123456", "0048 600-123-456", "48 600 123 456"])
      expect(nationalDigits(raw)).toBe("600123456");
  });
  it("clears the field when the +48 prefix is deleted (no '+48 48')", () => {
    expect(maskPhoneInput("+4", 2).value).toBe("");
    expect(maskPhoneInput("+48", 3).value).toBe("");
  });
  it("keeps the caret after the same digit when editing in the middle", () => {
    // caret after "6001" in "+48 6001 23" → after the 4th digit of the result
    const r = maskPhoneInput("+48 6001 23", 8);
    expect(r.value).toBe("+48 600 123");
    expect(r.value.slice(0, r.caret).replace(/\D/g, "").slice(2)).toBe("6001");
  });
  it("normalises to E.164", () => {
    expect(normalizePhone("600 123 456")).toBe("+48600123456");
    expect(normalizePhone("060 012 345")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+380501234567")).toBeNull();
    expect(normalizePhone("6001234567")).toBeNull();
    expect(normalizePhone("+486001234")).toBeNull();
    expect(normalizePhone("abc600123456")).toBeNull();
  });
  it("normalises Telegram names", () => {
    expect(normalizeTelegram("")).toBeNull();
    expect(normalizeTelegram("@john_doe")).toBe("@john_doe");
    expect(normalizeTelegram("t.me/john_doe")).toBe("@john_doe");
    expect(normalizeTelegram("ab")).toBe(false);
  });
});
