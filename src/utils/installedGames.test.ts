import { describe, expect, it } from "vitest";
import {
  normalizeAndDedupeInstalledGames,
  normalizeInstalledGame,
} from "./installedGames";

describe("normalizeInstalledGame", () => {
  it("reads camelCase keys and fills defaults", () => {
    const info = normalizeInstalledGame({
      gameId: 3,
      gameTitle: "Game",
      gameType: "WINDOWS_SETUP",
      versionId: 9,
      versionName: "v1.0.0",
      installationDirectory: "/x/Game",
      versionDirectory: "v1.0.0",
      installedAt: 123,
    });
    expect(info).toEqual({
      gameId: 3,
      gameTitle: "Game",
      gameMetadata: null,
      cachedMetadata: null,
      gameType: "WINDOWS_SETUP",
      versionId: 9,
      versionName: "v1.0.0",
      installationDirectory: "/x/Game",
      versionDirectory: "v1.0.0",
      installedAt: 123,
      lastPlayedAt: 0,
    });
  });

  it("falls back to snake_case keys and coerces installedAt to a number", () => {
    const info = normalizeInstalledGame({
      game_id: 5,
      game_title: "Legacy",
      installed_at: "456",
    });
    expect(info.gameId).toBe(5);
    expect(info.gameTitle).toBe("Legacy");
    expect(info.installedAt).toBe(456);
  });
});

describe("normalizeAndDedupeInstalledGames", () => {
  it("deduplicates by gameId:versionDirectory", () => {
    const result = normalizeAndDedupeInstalledGames([
      { gameId: 3, versionDirectory: "v1" },
      { gameId: 3, versionDirectory: "v1" },
      { gameId: 3, versionDirectory: "v2" },
    ]);
    expect(result).toHaveLength(2);
  });

  it("skips entries with a non-positive game id", () => {
    const result = normalizeAndDedupeInstalledGames([
      { gameId: 0, versionDirectory: "v1" },
      { gameId: -1, versionDirectory: "v1" },
      { gameId: 5, versionDirectory: "v1" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].gameId).toBe(5);
  });
});
