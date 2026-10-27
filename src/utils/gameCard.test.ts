// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  formatGameSize,
  initialGameBookmarked,
  resolveSortMetric,
} from "./gameCard";

beforeEach(() => {
  Object.defineProperty(navigator, "language", {
    value: "en-US",
    configurable: true,
  });
});

describe("formatGameSize", () => {
  it("returns null for missing/NaN values", () => {
    expect(formatGameSize()).toBeNull();
    expect(formatGameSize(undefined)).toBeNull();
    expect(formatGameSize(null as unknown as number)).toBeNull();
    expect(formatGameSize(NaN)).toBeNull();
  });

  it("keeps bytes below 1 KB", () => {
    expect(formatGameSize(512)).toBe("512 B");
  });

  it("scales to KB/MB/GB/PB", () => {
    expect(formatGameSize(1024)).toBe("1.00 KB");
    expect(formatGameSize(1.5 * 1024 * 1024)).toBe("1.50 MB");
  });
});

describe("initialGameBookmarked", () => {
  it("returns false without a current user", () => {
    expect(
      initialGameBookmarked({ bookmarked_users: [{ id: 1 }] }, undefined),
    ).toBe(false);
  });

  it("returns false when there is no bookmark array", () => {
    expect(initialGameBookmarked({}, 1)).toBe(false);
  });

  it("detects the current user in bookmarked_users / bookmarkedUsers", () => {
    expect(
      initialGameBookmarked({ bookmarked_users: [{ id: 2 }, { id: 1 }] }, 1),
    ).toBe(true);
    expect(
      initialGameBookmarked({ bookmarkedUsers: [{ ID: 1 }] }, 1),
    ).toBe(true);
    expect(initialGameBookmarked({ bookmarked_users: [{ id: 3 }] }, 1)).toBe(
      false,
    );
  });
});

describe("resolveSortMetric", () => {
  const game = {
    created_at: "2023-01-01",
    metadata: {
      release_date: "2022-06-15",
      rating: 87,
      average_playtime: 60,
    },
    download_count: 5,
  };

  it("uses the formatted size for size and default sorts", () => {
    expect(resolveSortMetric("size", game, "1.5 MB")).toBe("1.5 MB");
    expect(resolveSortMetric(undefined, game, "1.5 MB")).toBe("1.5 MB");
  });

  it("resolves created_at and release_date", () => {
    expect(resolveSortMetric("created_at", game, "x")).toContain("2023");
    expect(
      resolveSortMetric("metadata.release_date", game, "x"),
    ).toContain("2022");
    expect(resolveSortMetric("created_at", {}, "x")).toBeNull();
  });

  it("resolves rating, download count, and playtime", () => {
    expect(resolveSortMetric("metadata.rating", game, "x")).toBe("87.0%");
    expect(resolveSortMetric("download_count", game, "x")).toBe("5");
    expect(resolveSortMetric("metadata.average_playtime", game, "x")).toBe("1h");
  });
});
