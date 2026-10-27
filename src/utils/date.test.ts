import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatShortDate,
  formatTime,
  formatYear,
} from "./date";

describe("date helpers", () => {
  it("parses a date-only string as a local calendar date (no UTC shift)", () => {
    // If parsed as UTC midnight this could be a different day/year west of UTC.
    expect(formatYear("2023-01-01")).toBe("2023");
    expect(formatDate("2023-01-01")).not.toBe("—");
  });

  it("returns the fallback for empty/null/invalid input", () => {
    expect(formatDate("")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatYear("not-a-date")).toBe("");
    expect(formatTime(NaN)).toBe("");
  });

  it("handles Date instances and numbers", () => {
    expect(formatYear(new Date(2020, 4, 15))).toBe("2020");
    // 2020-05-15 as a timestamp (ms).
    expect(formatYear(new Date(2020, 4, 15).getTime())).toBe("2020");
  });

  it("supports a custom fallback", () => {
    expect(formatDate(undefined, "n/a")).toBe("n/a");
  });

  it("formats a short date with the year", () => {
    expect(formatShortDate("2023-01-01")).toContain("2023");
  });
});
