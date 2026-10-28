import { describe, expect, it } from "vitest";
import { isHalloweenSeason } from "@/config/halloween";

describe("Halloween decoration in the Polish calendar", () => {
  it.each([
    ["2026-10-24T21:59:59Z", false],
    ["2026-10-24T22:00:00Z", true],
    ["2026-10-28T12:00:00Z", true],
    ["2026-10-31T23:30:00Z", true],
    ["2026-11-02T22:59:59Z", true],
    ["2026-11-02T23:00:00Z", false],
    ["2026-12-25T12:00:00Z", false],
    ["2026-01-01T12:00:00Z", false],
  ])("%s → %s", (iso, expected) => {
    expect(isHalloweenSeason(new Date(iso))).toBe(expected);
  });

  it("ignores an invalid date", () => {
    expect(isHalloweenSeason(new Date("invalid"))).toBe(false);
  });
});
