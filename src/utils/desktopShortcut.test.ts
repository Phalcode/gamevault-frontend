import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGameDesktopShortcut,
  loadGameCoverBase64,
} from "./desktopShortcut";

const { invokeMock, mediaMock, base64Mock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  mediaMock: vi.fn(),
  base64Mock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/utils/mediaCache", () => ({ resolveApiMediaBlob: mediaMock }));
vi.mock("@/utils/binary", () => ({ blobToBase64: base64Mock }));

describe("createGameDesktopShortcut", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the native command with camelCase arguments", async () => {
    invokeMock.mockResolvedValue({
      path: "C:/Desktop/Game.url",
      icon: "executable",
    });

    const result = await createGameDesktopShortcut({
      gameId: 7,
      title: "Game",
      executablePath: "C:/Games/Game/Game.exe",
      coverBase64: null,
    });

    expect(invokeMock).toHaveBeenCalledWith("create_desktop_shortcut", {
      gameId: 7,
      title: "Game",
      executablePath: "C:/Games/Game/Game.exe",
      coverBase64: null,
    });
    expect(result).toEqual({
      path: "C:/Desktop/Game.url",
      icon: "executable",
    });
  });
});

describe("loadGameCoverBase64", () => {
  const authFetch = vi.fn();

  beforeEach(() => {
    mediaMock.mockReset();
    base64Mock.mockReset();
    authFetch.mockReset();
  });

  it("returns null without a cover id", async () => {
    expect(
      await loadGameCoverBase64({
        serverUrl: "https://example.test",
        authFetch,
        gameId: 7,
      }),
    ).toBeNull();
    expect(mediaMock).not.toHaveBeenCalled();
  });

  it("returns null without a server or auth fetch", async () => {
    expect(
      await loadGameCoverBase64({
        authFetch,
        gameId: 7,
        coverId: 3,
      }),
    ).toBeNull();
    expect(
      await loadGameCoverBase64({
        serverUrl: "https://example.test",
        gameId: 7,
        coverId: 3,
      }),
    ).toBeNull();
    expect(mediaMock).not.toHaveBeenCalled();
  });

  it("returns the cover as base64", async () => {
    const blob = new Blob(["cover"], { type: "image/png" });
    mediaMock.mockResolvedValue(blob);
    base64Mock.mockResolvedValue("Y292ZXI=");

    const result = await loadGameCoverBase64({
      serverUrl: "https://example.test",
      authFetch,
      gameId: 7,
      coverId: 3,
    });

    expect(result).toBe("Y292ZXI=");
    expect(mediaMock).toHaveBeenCalledWith({
      serverUrl: "https://example.test",
      mediaId: 3,
      authFetch,
      owner: { gameId: 7, slot: "cover" },
    });
    expect(base64Mock).toHaveBeenCalledWith(blob);
  });

  it("returns null when loading the cover fails", async () => {
    mediaMock.mockRejectedValue(new Error("offline"));

    expect(
      await loadGameCoverBase64({
        serverUrl: "https://example.test",
        authFetch,
        gameId: 7,
        coverId: 3,
      }),
    ).toBeNull();
  });
});
