import { describe, expect, it } from "vitest";
import {
  filterSearchableSettings,
  matchesQuery,
  rowHighlight,
  searchResultCategories,
  searchSettings,
  type SearchableSettingMeta,
} from "./settingsSearch";

const settings: SearchableSettingMeta[] = [
  {
    id: "a-theme",
    title: "Theme",
    description: "Pick a theme.",
    category: "appearance",
    keywords: ["dark", "light"],
  },
  {
    id: "b-autostart",
    title: "Start minimized",
    description: "Launch in the background.",
    category: "startup",
    keywords: [],
    desktopOnly: true,
  },
  {
    id: "c-web",
    title: "Web toggle",
    category: "appearance",
    keywords: ["web"],
    webOnly: true,
  },
  {
    id: "d-linux",
    title: "Wine prefix",
    category: "games",
    keywords: ["wine"],
    linuxOnly: true,
  },
];

describe("filterSearchableSettings", () => {
  it("includes all settings on a full desktop Linux build", () => {
    const result = filterSearchableSettings(settings, {
      isTauri: true,
      isDesktopApp: true,
      isLinux: true,
    });
    expect(result.map((s) => s.id)).toEqual(["a-theme", "b-autostart", "d-linux"]);
  });

  it("excludes desktop/linux-only settings on the web build", () => {
    const result = filterSearchableSettings(settings, {
      isTauri: false,
      isDesktopApp: false,
      isLinux: false,
    });
    expect(result.map((s) => s.id)).toEqual(["a-theme", "c-web"]);
  });
});

describe("matchesQuery", () => {
  it("matches title, description, and keywords", () => {
    expect(matchesQuery(settings[0], "theme")).toBe(true);
    expect(matchesQuery(settings[0], "pick")).toBe(true);
    expect(matchesQuery(settings[0], "dark")).toBe(true);
    expect(matchesQuery(settings[0], "zzz")).toBe(false);
  });

  it("returns true for an empty query", () => {
    expect(matchesQuery(settings[0], "")).toBe(true);
  });
});

describe("searchSettings", () => {
  it("returns [] for an empty query", () => {
    const flags = { isTauri: false, isDesktopApp: false, isLinux: false };
    expect(searchSettings(settings, "   ", flags)).toEqual([]);
  });

  it("filters by query and respects platform flags", () => {
    const flags = { isTauri: true, isDesktopApp: true, isLinux: true };
    expect(searchSettings(settings, "wine", flags).map((s) => s.id)).toEqual([
      "d-linux",
    ]);
    // "web" only appears in the web-only setting, hidden on desktop.
    expect(searchSettings(settings, "web", flags)).toEqual([]);
  });
});

describe("searchResultCategories", () => {
  it("deduplicates categories", () => {
    const results = [
      { category: "appearance", id: "x" },
      { category: "appearance", id: "y" },
      { category: "games", id: "z" },
    ];
    expect(searchResultCategories(results)).toEqual(["appearance", "games"]);
  });
});

describe("rowHighlight", () => {
  it("returns the highlight class only for the highlighted id", () => {
    expect(rowHighlight("a-theme", "a-theme")).toBe("bg-gv-accent/10");
    expect(rowHighlight("a-theme", "other")).toBe("");
    expect(rowHighlight(null, "a-theme")).toBe("");
  });
});
