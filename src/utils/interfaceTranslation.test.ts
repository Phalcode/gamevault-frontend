import { describe, expect, it } from "vitest";
import {
  INTERFACE_TRANSLATION_OFF,
  interfaceTranslationLanguageLabel,
  normalizeInterfaceTranslationLanguage,
} from "./interfaceTranslation";

describe("normalizeInterfaceTranslationLanguage", () => {
  it("keeps Mozilla model codes", () => {
    expect(normalizeInterfaceTranslationLanguage("de")).toBe("de");
    expect(normalizeInterfaceTranslationLanguage("pt")).toBe("pt");
    expect(normalizeInterfaceTranslationLanguage("zh_hant")).toBe("zh_hant");
  });

  it("normalises case and whitespace", () => {
    expect(normalizeInterfaceTranslationLanguage("  DE ")).toBe("de");
    expect(normalizeInterfaceTranslationLanguage("ZH_HANT")).toBe("zh_hant");
  });

  it("falls back to off for empty, unknown or unsafe values", () => {
    expect(normalizeInterfaceTranslationLanguage("")).toBe(
      INTERFACE_TRANSLATION_OFF,
    );
    expect(normalizeInterfaceTranslationLanguage(null)).toBe(
      INTERFACE_TRANSLATION_OFF,
    );
    expect(normalizeInterfaceTranslationLanguage(undefined)).toBe(
      INTERFACE_TRANSLATION_OFF,
    );
    expect(normalizeInterfaceTranslationLanguage("off")).toBe(
      INTERFACE_TRANSLATION_OFF,
    );
    expect(normalizeInterfaceTranslationLanguage("../../etc/passwd")).toBe(
      INTERFACE_TRANSLATION_OFF,
    );
    expect(normalizeInterfaceTranslationLanguage("de;rm -rf /")).toBe(
      INTERFACE_TRANSLATION_OFF,
    );
  });
});

describe("interfaceTranslationLanguageLabel", () => {
  it("returns a non-empty label for known codes", () => {
    for (const code of ["de", "fr", "zh_hant"]) {
      expect(interfaceTranslationLanguageLabel(code).length).toBeGreaterThan(0);
    }
  });

  it("falls back to the raw code for nonsense", () => {
    expect(interfaceTranslationLanguageLabel("qqq")).toBe("qqq");
  });
});
