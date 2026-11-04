// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTranslationCache,
  flushTranslationCache,
  getCachedTranslation,
  isTranslationCacheLoaded,
  loadTranslationCache,
  rememberTranslations,
} from "./translationCache";

beforeEach(() => {
  localStorage.clear();
});

describe("translation cache", () => {
  it("stores translations for the active language", () => {
    rememberTranslations("de", [["Library", "Bibliothek"]]);

    expect(isTranslationCacheLoaded("de")).toBe(true);
    expect(getCachedTranslation("de", "Library")).toBe("Bibliothek");
  });

  it("ignores empty and unchanged pairs", () => {
    rememberTranslations("fr", [
      ["", "Ignored"],
      ["Same", "Same"],
    ]);

    expect(getCachedTranslation("fr", "")).toBeUndefined();
    expect(getCachedTranslation("fr", "Same")).toBeUndefined();
  });

  it("persists and reloads the cache", async () => {
    rememberTranslations("it", [["Library", "Biblioteca"]]);
    await flushTranslationCache();

    vi.resetModules();
    const fresh = await import("./translationCache");

    expect(fresh.getCachedTranslation("it", "Library")).toBeUndefined();
    await fresh.loadTranslationCache("it");
    expect(fresh.getCachedTranslation("it", "Library")).toBe("Biblioteca");
  });

  it("ignores corrupt stored data", async () => {
    localStorage.setItem("gv_interface_translations:xx", "{not json");

    vi.resetModules();
    const fresh = await import("./translationCache");

    await expect(fresh.loadTranslationCache("xx")).resolves.toEqual(new Map());
  });

  it("clears memory and storage for one language", async () => {
    rememberTranslations("es", [["Library", "Biblioteca"]]);
    await flushTranslationCache();

    await clearTranslationCache("es");

    expect(isTranslationCacheLoaded("es")).toBe(false);
    expect(localStorage.getItem("gv_interface_translations:es")).toBeNull();
  });
});
