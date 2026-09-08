import { describe, expect, it } from "vitest";
import { buildCacheKey, buildGamesQueryParams } from "./gamesQuery";

describe("buildGamesQueryParams", () => {
  it("builds search/sort/limit params", () => {
    const params = buildGamesQueryParams({
      search: "minecraft",
      sortBy: "sort_title",
      order: "DESC",
      limit: 25,
    });
    expect(params.get("search")).toBe("minecraft");
    expect(params.get("sortBy")).toBe("sort_title:DESC");
    expect(params.get("limit")).toBe("25");
  });

  it("maps bookmark filters for the current user only", () => {
    const mine = buildGamesQueryParams({ bookmarkFilter: "mine", userId: 42 });
    expect(mine.get("filter.bookmarked_users.id")).toBe("$eq:42");

    const others = buildGamesQueryParams({
      bookmarkFilter: "others",
      userId: 42,
    });
    expect(others.get("filter.bookmarked_users.id")).toBe("$not:$eq:42");

    // Without a user id, no bookmark filter is emitted.
    const anon = buildGamesQueryParams({ bookmarkFilter: "mine" });
    expect(anon.has("filter.bookmarked_users.id")).toBe(false);
  });

  it("emits $in params for type/tag/genre/developer/publisher filters", () => {
    const params = buildGamesQueryParams({
      gameTypes: ["WINDOWS_SETUP", "LINUX_PORTABLE"],
      tags: ["horror"],
      genres: ["action"],
      developers: ["studio"],
      publishers: ["pub"],
    });
    expect(params.get("filter.type")).toBe(
      "$in:WINDOWS_SETUP,LINUX_PORTABLE",
    );
    expect(params.get("filter.metadata.tags.name")).toBe("$in:horror");
    expect(params.get("filter.metadata.genres.name")).toBe("$in:action");
    expect(params.get("filter.metadata.developers.name")).toBe("$in:studio");
    expect(params.get("filter.metadata.publishers.name")).toBe("$in:pub");
  });

  it("maps game state with a user id", () => {
    const params = buildGamesQueryParams({
      gameState: "COMPLETED",
      userId: 7,
    });
    expect(params.get("filter.progresses.state")).toBe("$eq:COMPLETED");
    expect(params.get("filter.progresses.user.id")).toBe("$eq:7");

    // Without a user id the state filter is omitted.
    expect(buildGamesQueryParams({ gameState: "COMPLETED" }).has("filter.progresses.state")).toBe(
      false,
    );
  });

  it("maps release date ranges", () => {
    const both = buildGamesQueryParams({
      releaseDateFrom: "2020-01-01",
      releaseDateTo: "2020-12-31",
    });
    expect(both.get("filter.metadata.release_date")).toBe(
      "$btw:2020-01-01,2020-12-31",
    );

    const gte = buildGamesQueryParams({ releaseDateFrom: "2020-01-01" });
    expect(gte.get("filter.metadata.release_date")).toBe("$gte:2020-01-01");

    const lte = buildGamesQueryParams({ releaseDateTo: "2020-12-31" });
    expect(lte.get("filter.metadata.release_date")).toBe("$lte:2020-12-31");
  });

  it("maps early access filters", () => {
    expect(
      buildGamesQueryParams({ earlyAccess: "true" }).get(
        "filter.metadata.early_access",
      ),
    ).toBe("$eq:true");
    expect(
      buildGamesQueryParams({ earlyAccess: "false" }).get(
        "filter.metadata.early_access",
      ),
    ).toBe("$eq:false");
    expect(buildGamesQueryParams({ earlyAccess: "all" }).has("filter.metadata.early_access")).toBe(
      false,
    );
  });
});

describe("buildCacheKey", () => {
  const base = {
    search: "",
    sortBy: "sort_title",
    order: "ASC",
  };

  it("is stable when array order changes", () => {
    const a = buildCacheKey(
      { ...base, gameTypes: ["a", "b"] },
      "http://x",
      1,
    );
    const b = buildCacheKey(
      { ...base, gameTypes: ["b", "a"] },
      "http://x",
      1,
    );
    expect(a).toBe(b);
  });

  it("differs when filters change", () => {
    const a = buildCacheKey({ ...base, search: "a" }, "http://x", 1);
    const b = buildCacheKey({ ...base, search: "b" }, "http://x", 1);
    expect(a).not.toBe(b);
  });

  it("isolates cache by server and user id", () => {
    const a = buildCacheKey(base, "http://x", 1);
    const b = buildCacheKey(base, "http://y", 1);
    const c = buildCacheKey(base, "http://x", 2);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
