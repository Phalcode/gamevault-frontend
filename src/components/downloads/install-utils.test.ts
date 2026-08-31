import { describe, expect, it } from "vitest";
import { pickPreferredExecutable, pickPreferredInstaller } from "./install-utils";

describe("pickPreferredExecutable", () => {
  const executables = ["Game/Game.exe", "Game/run.sh", "setup/Setup.exe"];

  it("returns an empty string when no executables are available", () => {
    expect(pickPreferredExecutable([], "Game/Game.exe")).toBe("");
    expect(pickPreferredExecutable([])).toBe("");
  });

  it("auto-detects the first executable when no preferred is configured", () => {
    expect(pickPreferredExecutable(executables)).toBe("Game/Game.exe");
    expect(pickPreferredExecutable(executables, "")).toBe("Game/Game.exe");
    expect(pickPreferredExecutable(executables, "   ")).toBe("Game/Game.exe");
  });

  it("prefers an exact match against the configured launch executable", () => {
    expect(pickPreferredExecutable(executables, "Game/run.sh")).toBe(
      "Game/run.sh",
    );
  });

  it("matches case-insensitively and normalizes separators", () => {
    expect(pickPreferredExecutable(executables, "GAME\\GAME.EXE")).toBe(
      "Game/Game.exe",
    );
  });

  it("falls back to the first executable when the preferred one is not found", () => {
    expect(pickPreferredExecutable(executables, "missing/foo.exe")).toBe(
      "Game/Game.exe",
    );
  });
});

describe("pickPreferredInstaller", () => {
  const installers = ["setup/Setup.exe", "setup/installer.msi"];

  it("returns an empty string when no installers are available", () => {
    expect(pickPreferredInstaller([], "setup/Setup.exe")).toBe("");
  });

  it("auto-selects the first installer when no preferred is configured", () => {
    expect(pickPreferredInstaller(installers)).toBe("setup/Setup.exe");
  });
});
