import { describe, expect, it } from "vitest";
import type { InstalledGameInfo } from "@/hooks/useInstalledGames";
import {
  installedGameTitle,
  lastActivityAt,
  trayRecentGames,
} from "./trayRecentGames";

function installed(overrides: Partial<InstalledGameInfo>): InstalledGameInfo {
  return {
    gameId: 1,
    gameTitle: "Game",
    gameMetadata: null,
    cachedMetadata: null,
    gameType: null,
    versionId: 1,
    versionName: "1.0",
    installationDirectory: "/games/1",
    versionDirectory: "/games/1/Versions/1.0",
    installedAt: 0,
    lastPlayedAt: 0,
    ...overrides,
  };
}

describe("lastActivityAt", () => {
  it("uses the newer of played and installed", () => {
    expect(
      lastActivityAt(installed({ lastPlayedAt: 100, installedAt: 500 })),
    ).toBe(500);
    expect(
      lastActivityAt(installed({ lastPlayedAt: 900, installedAt: 500 })),
    ).toBe(900);
  });

  it("is zero for a game that was never played and has no install time", () => {
    expect(lastActivityAt(installed({}))).toBe(0);
  });
});

describe("installedGameTitle", () => {
  it("prefers the folder's title, then the cached metadata, then a placeholder", () => {
    expect(installedGameTitle(installed({ gameTitle: "Portal 2" }))).toBe(
      "Portal 2",
    );
    expect(
      installedGameTitle(
        installed({
          gameTitle: "",
          cachedMetadata: { metadata: { title: "Hollow Knight" } },
        }),
      ),
    ).toBe("Hollow Knight");
    expect(installedGameTitle(installed({ gameTitle: "" }))).toBe("Game");
  });
});

describe("trayRecentGames", () => {
  it("mixes played and freshly installed games by recency", () => {
    const playedLongAgo = installed({
      gameId: 1,
      gameTitle: "Played long ago",
      lastPlayedAt: 1_000,
    });
    const justInstalled = installed({
      gameId: 2,
      gameTitle: "Just installed",
      installedAt: 9_000,
    });
    const playedRecently = installed({
      gameId: 3,
      gameTitle: "Played recently",
      installedAt: 2_000,
      lastPlayedAt: 5_000,
    });

    expect(
      trayRecentGames([playedLongAgo, justInstalled, playedRecently], 5).map(
        (game) => game.title,
      ),
    ).toEqual(["Just installed", "Played recently", "Played long ago"]);
  });

  it("ranks a game by its play time once that overtakes its install time", () => {
    const game = installed({
      gameId: 4,
      installedAt: 1_000,
      lastPlayedAt: 8_000,
    });
    const other = installed({ gameId: 5, installedAt: 5_000 });

    expect(trayRecentGames([other, game], 5).map((g) => g.gameId)).toEqual([
      4, 5,
    ]);
  });

  it("drops games without any activity and games without an id", () => {
    const games = [
      installed({ gameId: 1, gameTitle: "Never touched" }),
      installed({ gameId: 0, gameTitle: "Broken cache", installedAt: 5_000 }),
      installed({ gameId: 2, gameTitle: "Kept", installedAt: 1_000 }),
    ];

    expect(trayRecentGames(games, 5).map((g) => g.gameId)).toEqual([2]);
  });

  it("caps the list and breaks ties on the game id", () => {
    const games = [
      installed({ gameId: 3, gameTitle: "C", installedAt: 1_000 }),
      installed({ gameId: 1, gameTitle: "A", installedAt: 1_000 }),
      installed({ gameId: 2, gameTitle: "B", installedAt: 1_000 }),
    ];

    expect(trayRecentGames(games, 2).map((g) => g.gameId)).toEqual([1, 2]);
  });

  it("does not mutate the caller's array", () => {
    const games = [
      installed({ gameId: 1, installedAt: 1_000 }),
      installed({ gameId: 2, installedAt: 9_000 }),
    ];
    const originalOrder = games.map((game) => game.gameId);

    trayRecentGames(games, 5);

    expect(games.map((game) => game.gameId)).toEqual(originalOrder);
  });
});
