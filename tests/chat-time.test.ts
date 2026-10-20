import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTime } from "@/lib/api";

afterEach(() => vi.useRealTimers());

describe("Polish chat time", () => {
  it.each([
    ["2026-01-15T12:10:00Z", "13:10"],
    ["2026-07-15T12:10:00Z", "14:10"],
    ["2026-03-29T00:30:00Z", "01:30"],
    ["2026-03-29T01:30:00Z", "03:30"],
    ["2026-10-25T00:30:00Z", "02:30"],
    ["2026-10-25T01:30:00Z", "02:30"],
  ])("formats %s in Warsaw, including daylight saving changes", (iso, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));

    // The panel language changes labels, not the business timezone or 24-hour clock.
    for (const locale of ["pl-PL", "ru-RU", "en-US"]) {
      expect(formatTime(iso, locale)).toBe(expected);
    }
  });

  it("decides whether to show the date using the calendar day in Poland", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T22:30:00Z")); // 16 June, 00:30 in Warsaw.

    expect(formatTime("2026-06-15T22:05:00Z", "pl-PL")).toBe("00:05");
    const previousDay = formatTime("2026-06-15T21:55:00Z", "pl-PL");
    expect(previousDay).toContain("15");
    expect(previousDay).toContain("23:55");
    expect(previousDay).not.toBe("23:55");
  });
});
