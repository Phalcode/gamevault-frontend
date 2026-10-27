// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formatDecimal, formatNumber, formatTrimmedNumber } from "./number";

function withLocale(locale: string, fn: () => void): void {
  const original = (navigator as unknown as { language: string }).language;
  Object.defineProperty(navigator, "language", {
    value: locale,
    configurable: true,
  });
  try {
    fn();
  } finally {
    Object.defineProperty(navigator, "language", {
      value: original,
      configurable: true,
    });
  }
}

describe("number helpers", () => {
  it("uses a locale decimal separator (de vs en)", () => {
    withLocale("de-DE", () => {
      expect(formatDecimal(1.5, 2)).toBe("1,50");
    });
    withLocale("en-US", () => {
      expect(formatDecimal(1.5, 2)).toBe("1.50");
    });
  });

  it("keeps trailing zeros for formatDecimal", () => {
    withLocale("en-US", () => {
      expect(formatDecimal(2, 2)).toBe("2.00");
    });
  });

  it("trims trailing zeros for formatTrimmedNumber", () => {
    withLocale("en-US", () => {
      expect(formatTrimmedNumber(1.5, 2)).toBe("1.5");
      expect(formatTrimmedNumber(1.234, 2)).toBe("1.23");
    });
  });

  it("formats an integer with no fraction digits", () => {
    withLocale("en-US", () => {
      expect(formatNumber(1234)).toBe("1,234");
    });
  });
});
