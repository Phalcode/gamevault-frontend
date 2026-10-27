import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  buildInstalledGameMap,
  filterAndSortInstalledGames,
  getParamValues,
  hasActiveFilters,
  isBookmark,
  isEarlyAccess,
  isGameType,
  isProgressState,
  setParamValues,
  type LibraryFilterState,
} from "./libraryFilters";
import { GamevaultGameTypeEnum } from "@/api/models/GamevaultGame";
import { ProgressStateEnum } from "@/api/models/Progress";

const defaults = (): LibraryFilterState => ({
  bookmarkFilter: "all",
  earlyAccess: "all",
  gameState: "",
  releaseDateFrom: "",
  releaseDateTo: "",
  gameTypes: [],
  tags: [],
  genres: [],
  developers: [],
  publishers: [],
});

describe("hasActiveFilters / activeFilterCount", () => {
  it("is false / 0 when everything is default", () => {
    expect(hasActiveFilters(defaults())).toBe(false);
    expect(activeFilterCount(defaults())).toBe(0);
  });

  it("counts single-value and array filters", () => {
    const state = {
      ...defaults(),
      bookmarkFilter: "mine" as const,
      earlyAccess: "true" as const,
      gameState: ProgressStateEnum.completed,
      gameTypes: ["WINDOWS_SETUP", "LINUX_PORTABLE"],
      tags: ["horror"],
    };
    expect(hasActiveFilters(state)).toBe(true);
    expect(activeFilterCount(state)).toBe(6); // mine + true + completed + 2 types + 1 tag
  });
});

describe("getParamValues / setParamValues", () => {
  it("reads repeated params", () => {
    const params = new URLSearchParams("q=a&q=b");
    expect(getParamValues(params, "q")).toEqual(["a", "b"]);
  });

  it("returns a single present value as-is", () => {
    // When the key exists, getAll returns the raw value(s); no comma split.
    const params = new URLSearchParams("types=a,b");
    expect(getParamValues(params, "types")).toEqual(["a,b"]);
  });

  it("returns an empty array when missing", () => {
    expect(getParamValues(new URLSearchParams(), "x")).toEqual([]);
  });

  it("writes multiple values and deletes when empty", () => {
    const params = new URLSearchParams();
    setParamValues(params, "types", ["a", "b"]);
    expect(params.getAll("types")).toEqual(["a", "b"]);
    setParamValues(params, "types", []);
    expect(params.has("types")).toBe(false);
  });
});

describe("type guards", () => {
  it("isEarlyAccess / isBookmark", () => {
    expect(isEarlyAccess("true")).toBe(true);
    expect(isEarlyAccess("maybe")).toBe(false);
    expect(isBookmark("1")).toBe(true);
    expect(isBookmark("mine")).toBe(true);
    expect(isBookmark("nope")).toBe(false);
  });

  it("isGameType / isProgressState", () => {
    expect(isGameType(GamevaultGameTypeEnum.windows_setup)).toBe(true);
    expect(isGameType("NOPE")).toBe(false);
    expect(isProgressState(ProgressStateEnum.completed)).toBe(true);
    expect(isProgressState("NOPE")).toBe(false);
  });
});

describe("buildInstalledGameMap", () => {
  it("maps ids and skips non-positive ones", () => {
    const map = buildInstalledGameMap([
      { gameId: 3, name: "a" },
      { gameId: 0, name: "b" },
      { gameId: -1, name: "c" },
    ]);
    expect(map.get(3)).toEqual({ gameId: 3, name: "a" });
    expect(map.size).toBe(1);
  });
});

describe("filterAndSortInstalledGames", () => {
  const base = (over: any = {}) => ({
    id: 1,
    title: "Game",
    sort_title: "game",
    type: GamevaultGameTypeEnum.windows_setup,
    metadata: {},
    _installedInfo: { installedAt: 100, lastPlayedAt: 0 },
    ...over,
  });

  it("filters by case-insensitive search", () => {
    const games = [
      base({ id: 1, title: "Minecraft" }),
      base({ id: 2, title: "Terraria" }),
    ];
    expect(
      filterAndSortInstalledGames(games, {
        search: "mine",
        gameTypes: [],
        tags: [],
        genres: [],
        developers: [],
        publishers: [],
      }),
    ).toHaveLength(1);
  });

  it("filters by game type and metadata names", () => {
    const games = [
      base({
        id: 1,
        type: GamevaultGameTypeEnum.windows_setup,
        metadata: { tags: [{ name: "horror" }] },
      }),
      base({ id: 2, type: GamevaultGameTypeEnum.linux_portable }),
    ];
    const result = filterAndSortInstalledGames(games, {
      search: "",
      gameTypes: [GamevaultGameTypeEnum.windows_setup],
      tags: ["horror"],
      genres: [],
      developers: [],
      publishers: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("sorts by most-recent activity with a title tie-break", () => {
    const games = [
      base({ id: 1, title: "Beta", sort_title: "beta", _installedInfo: { installedAt: 50, lastPlayedAt: 0 } }),
      base({ id: 2, title: "Alpha", sort_title: "alpha", _installedInfo: { installedAt: 200, lastPlayedAt: 0 } }),
      base({ id: 3, title: "Same B", sort_title: "same b", _installedInfo: { installedAt: 50, lastPlayedAt: 0 } }),
    ];
    const result = filterAndSortInstalledGames(games, {
      search: "",
      gameTypes: [],
      tags: [],
      genres: [],
      developers: [],
      publishers: [],
    });
    // Most recent first.
    expect(result[0].id).toBe(2);
    // Tie-broken by title ascending.
    expect(result[1].id).toBe(1);
    expect(result[2].id).toBe(3);
  });
});
