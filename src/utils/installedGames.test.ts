import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findInstalledGameById,
  installedGameKey,
  installedGameOriginServerUrl,
  installedGameOwnerForServer,
  normalizeAndDedupeInstalledGames,
  normalizeInstalledGame,
} from "./installedGames";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
const { rootPathsMock } = vi.hoisted(() => ({ rootPathsMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/utils/rootPaths", () => ({ getRootPaths: rootPathsMock }));

const SERVER_IDENTIFIERS = ["uuid-a", "https://a.example"];

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
      owners: [],
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

describe("server ownership helpers", () => {
  const game = normalizeInstalledGame({
    gameId: 5,
    versionDirectory: "v1",
    owners: [
      {
        serverUrl: "https://a.example",
        identifiers: ["https://a.example", "uuid-a"],
        gameId: 5,
      },
      {
        serverUrl: "https://b.example",
        identifiers: ["https://b.example", "uuid-b"],
        gameId: 7,
      },
    ],
  });

  it("matches owners by server identifier, not by game id", () => {
    expect(
      installedGameOwnerForServer(game, ["https://b.example"])?.gameId,
    ).toBe(7);
    expect(
      installedGameOwnerForServer(game, ["https://c.example"]),
    ).toBeUndefined();
  });

  it("labels another server by host", () => {
    const owner = installedGameOwnerForServer(game, ["https://b.example"]);
    expect(owner?.serverUrl).toBe("https://b.example");
  });

  it("returns the real origin server URL for the tooltip and settings", () => {
    expect(installedGameOriginServerUrl(game, ["https://b.example"])).toBe(
      "https://b.example",
    );
  });

  it("builds a server-specific key for the same game id", () => {
    const other = normalizeInstalledGame({
      gameId: 5,
      versionDirectory: "v1",
      owners: [
        {
          serverUrl: "https://b.example",
          identifiers: ["https://b.example"],
          gameId: 5,
        },
      ],
    });

    expect(installedGameKey(game)).not.toBe(installedGameKey(other));
  });
});

describe("findInstalledGameById", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    rootPathsMock.mockReset();
  });

  it("finds a game installed in a later root", async () => {
    rootPathsMock.mockReturnValue([
      { id: "a", path: "C:/games", label: "" },
      { id: "b", path: "D:/games", label: "" },
    ]);
    invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        gameId: 7,
        gameTitle: "Seven",
        installationDirectory: "D:/games/GameVault/Seven",
        versionDirectory: "D:/games/GameVault/Seven/1.0.0",
        owners: [
          {
            serverUrl: "https://a.example",
            identifiers: ["uuid-a", "https://a.example"],
            gameId: 7,
          },
        ],
      },
    ]);

    const game = await findInstalledGameById(7, SERVER_IDENTIFIERS);

    expect(game?.gameTitle).toBe("Seven");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "list_installed_games", {
      selectedRoot: "C:/games",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_installed_games", {
      selectedRoot: "D:/games",
    });
  });

  it("stops scanning once the game is found", async () => {
    rootPathsMock.mockReturnValue([
      { id: "a", path: "C:/games", label: "" },
      { id: "b", path: "D:/games", label: "" },
    ]);
    invokeMock.mockResolvedValueOnce([
      {
        gameId: 3,
        installationDirectory: "C:/games/GameVault/Three",
        versionDirectory: "C:/games/GameVault/Three/1.0.0",
        owners: [
          {
            serverUrl: "https://a.example",
            identifiers: ["uuid-a", "https://a.example"],
            gameId: 3,
          },
        ],
      },
    ]);

    await findInstalledGameById(3, SERVER_IDENTIFIERS);

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("skips an unreadable root", async () => {
    rootPathsMock.mockReturnValue([
      { id: "a", path: "C:/games", label: "" },
      { id: "b", path: "D:/games", label: "" },
    ]);
    invokeMock
      .mockRejectedValueOnce(new Error("unreadable"))
      .mockResolvedValueOnce([
        {
          gameId: 5,
          installationDirectory: "D:/x",
          versionDirectory: "D:/x/1.0.0",
          owners: [
            {
              serverUrl: "https://a.example",
              identifiers: ["uuid-a", "https://a.example"],
              gameId: 5,
            },
          ],
        },
      ]);

    const game = await findInstalledGameById(5, SERVER_IDENTIFIERS);

    expect(game?.gameId).toBe(5);
  });

  it("returns null when the game is not installed", async () => {
    rootPathsMock.mockReturnValue([{ id: "a", path: "C:/games", label: "" }]);
    invokeMock.mockResolvedValueOnce([{ gameId: 1 }]);

    expect(await findInstalledGameById(99, SERVER_IDENTIFIERS)).toBeNull();
  });

  it("ignores matches without installation directories", async () => {
    rootPathsMock.mockReturnValue([{ id: "a", path: "C:/games", label: "" }]);
    invokeMock.mockResolvedValueOnce([
      {
        gameId: 4,
        installationDirectory: "C:/x",
        versionDirectory: "",
        owners: [
          {
            serverUrl: "https://a.example",
            identifiers: ["uuid-a", "https://a.example"],
            gameId: 4,
          },
        ],
      },
    ]);

    expect(await findInstalledGameById(4, SERVER_IDENTIFIERS)).toBeNull();
  });

  it("returns null without scanning when no root is configured", async () => {
    rootPathsMock.mockReturnValue([]);

    expect(await findInstalledGameById(4, SERVER_IDENTIFIERS)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects invalid ids without scanning", async () => {
    rootPathsMock.mockReturnValue([{ id: "a", path: "C:/games", label: "" }]);

    expect(await findInstalledGameById(0, SERVER_IDENTIFIERS)).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
