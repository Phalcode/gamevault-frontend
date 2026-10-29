import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  buildInstalledGameMap,
  collectInstalledMetadataNames,
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
      base({
        id: 1,
        title: "Beta",
        sort_title: "beta",
        _installedInfo: { installedAt: 50, lastPlayedAt: 0 },
      }),
      base({
        id: 2,
        title: "Alpha",
        sort_title: "alpha",
        _installedInfo: { installedAt: 200, lastPlayedAt: 0 },
      }),
      base({
        id: 3,
        title: "Same B",
        sort_title: "same b",
        _installedInfo: { installedAt: 50, lastPlayedAt: 0 },
      }),
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

  const emptyFilters = {
    search: "",
    gameTypes: [] as string[],
    tags: [] as string[],
    genres: [] as string[],
    developers: [] as string[],
    publishers: [] as string[],
  };

  it("sorts by the active library sort key and direction", () => {
    const games = [
      base({
        id: 1,
        title: "Beta",
        sort_title: "beta",
        metadata: { rating: 90, release_date: "2020-05-01" },
      }),
      base({
        id: 2,
        title: "Alpha",
        sort_title: "alpha",
        metadata: { rating: 40, release_date: "2022-01-01" },
      }),
      base({ id: 3, title: "Gamma", sort_title: "gamma", metadata: {} }),
    ];

    const byTitle = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      sortBy: "sort_title",
      order: "ASC",
    });
    expect(byTitle.map((g) => g.id)).toEqual([2, 1, 3]);

    const byRatingDesc = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      sortBy: "metadata.rating",
      order: "DESC",
    });
    // Missing rating sinks to the end regardless of direction.
    expect(byRatingDesc.map((g) => g.id)).toEqual([1, 2, 3]);

    const byReleaseDateAsc = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      sortBy: "metadata.release_date",
      order: "ASC",
    });
    expect(byReleaseDateAsc.map((g) => g.id)).toEqual([1, 2, 3]);
  });

  it("sorts by size using the installed version when the mirror is missing", () => {
    const games = [
      base({ id: 1, title: "Small", size: "100" }),
      base({
        id: 2,
        title: "Big",
        versions: [{ id: 7, size: "9000" }],
        _installedInfo: { installedAt: 1, lastPlayedAt: 0, versionId: 7 },
      }),
    ];
    const result = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      sortBy: "size",
      order: "DESC",
    });
    expect(result.map((g) => g.id)).toEqual([2, 1]);
  });

  it("filters bookmarks, progress state, release range and early access", () => {
    const games = [
      base({
        id: 1,
        bookmarkFilter: "all",
        bookmarked_users: [{ id: 5 }],
        progresses: [{ user: { id: 5 }, state: ProgressStateEnum.playing }],
        metadata: { release_date: "2019-03-01", early_access: true },
      }),
      base({
        id: 2,
        bookmarked_users: [{ id: 9 }],
        progresses: [{ user: { id: 5 }, state: ProgressStateEnum.completed }],
        metadata: { release_date: "2024-11-20", early_access: false },
      }),
      base({
        id: 3,
        bookmarked_users: [],
        progresses: [],
        metadata: { release_date: "2021-07-07", early_access: false },
      }),
    ];

    const mine = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      bookmarkFilter: "mine",
      userId: 5,
    });
    expect(mine.map((g) => g.id)).toEqual([1]);

    const others = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      bookmarkFilter: "others",
      userId: 5,
    });
    expect(others.map((g) => g.id)).toEqual([2]);

    const playing = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      gameState: ProgressStateEnum.playing,
      userId: 5,
    });
    expect(playing.map((g) => g.id)).toEqual([1]);

    // "Unplayed" means no progress record or an explicit UNPLAYED state.
    const unplayed = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      gameState: ProgressStateEnum.unplayed,
      userId: 5,
    });
    expect(unplayed.map((g) => g.id)).toEqual([3]);

    const recent = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      releaseDateFrom: "2024-01-01",
      releaseDateTo: "2024-12-31",
    });
    expect(recent.map((g) => g.id)).toEqual([2]);

    const earlyAccess = filterAndSortInstalledGames(games, {
      ...emptyFilters,
      earlyAccess: "true",
    });
    expect(earlyAccess.map((g) => g.id)).toEqual([1]);
  });

  it("collects distinct metadata names sorted alphabetically", () => {
    const games = [
      base({
        metadata: {
          tags: [{ name: "Horror" }, { name: "Co-op" }],
        },
      }),
      base({ metadata: { tags: [{ name: "horror" }, { name: "Puzzle" }] } }),
      base({ metadata: {} }),
    ];
    expect(collectInstalledMetadataNames(games, "tags")).toEqual([
      { id: "Co-op", name: "Co-op" },
      { id: "Horror", name: "Horror" },
      { id: "Puzzle", name: "Puzzle" },
    ]);
  });
});
