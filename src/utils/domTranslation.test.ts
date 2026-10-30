// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bergamotEngine", () => ({
  ensureBergamotModelLoaded: vi.fn().mockResolvedValue(undefined),
  translateStringsWithBergamot: vi.fn(async (texts: string[]) =>
    texts.map((text) => `T:${text}`),
  ),
}));

import { translateStringsWithBergamot } from "./bergamotEngine";
import {
  applyCachedUiTranslations,
  startUiTranslation,
  stopUiTranslation,
} from "./domTranslation";
import {
  clearTranslationCache,
  rememberTranslations,
} from "./translationCache";

function render(): void {
  document.body.innerHTML =
    "<div><span>Library</span><span>Settings</span></div>";
}

function texts(): string[] {
  return [...document.querySelectorAll("span")].map(
    (span) => span.textContent ?? "",
  );
}

describe("domTranslation", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  afterEach(async () => {
    stopUiTranslation();
    await clearTranslationCache("de");
  });

  it("applies cached translations synchronously", () => {
    rememberTranslations("de", [["Library", "Bibliothek"]]);
    render();

    expect(applyCachedUiTranslations("de")).toBe(1);
    expect(texts()).toEqual(["Bibliothek", "Settings"]);
    expect(translateStringsWithBergamot).not.toHaveBeenCalled();
  });

  it("only sends strings without a cached translation to the engine", async () => {
    rememberTranslations("de", [["Library", "Bibliothek"]]);
    render();

    await startUiTranslation("de");

    expect(texts()).toEqual(["Bibliothek", "T:Settings"]);
    expect(translateStringsWithBergamot).toHaveBeenCalledWith(
      ["Settings"],
      "de",
    );
  });

  it("restores the English text when translation stops", async () => {
    rememberTranslations("de", [["Library", "Bibliothek"]]);
    render();

    await startUiTranslation("de");
    stopUiTranslation();

    expect(texts()).toEqual(["Library", "Settings"]);
  });
});
