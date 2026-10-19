import { describe, expect, it } from "vitest";
import {
  isGameUpdateAvailable,
  normalizeVersionTag,
  resolveServerVersionTag,
  resolveVersionPlatform,
} from "./gameUpdate";

describe("normalizeVersionTag", () => {
  it("trims and lowercases", () => {
    expect(normalizeVersionTag("  V1.0.0 ")).toBe("1.0.0");
  });

  it("strips a leading v / v. prefix", () => {
    expect(normalizeVersionTag("v1.2.0")).toBe("1.2.0");
    expect(normalizeVersionTag("v.1.2.0")).toBe("1.2.0");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeVersionTag("1.0   Beta")).toBe("1.0 beta");
  });

  it("treats missing values as empty", () => {
    expect(normalizeVersionTag(undefined)).toBe("");
    expect(normalizeVersionTag(null)).toBe("");
    expect(normalizeVersionTag("")).toBe("");
  });
});

describe("resolveVersionPlatform", () => {
  it("maps version types to OS families", () => {
    expect(resolveVersionPlatform("WINDOWS_SETUP")).toBe("windows");
    expect(resolveVersionPlatform("WINDOWS_PORTABLE")).toBe("windows");
    expect(resolveVersionPlatform("WINDOWS_SOFTWARE")).toBe("windows");
    expect(resolveVersionPlatform("LINUX_PORTABLE")).toBe("linux");
    expect(resolveVersionPlatform("LINUX_SOFTWARE")).toBe("linux");
  });

  it("returns null for undetectable or missing types", () => {
    expect(resolveVersionPlatform("UNDETECTABLE")).toBeNull();
    expect(resolveVersionPlatform("")).toBeNull();
    expect(resolveVersionPlatform(undefined)).toBeNull();
    expect(resolveVersionPlatform(null)).toBeNull();
  });
});

describe("resolveServerVersionTag", () => {
  it("prefers the legacy version mirror", () => {
    expect(resolveServerVersionTag({ version: "v2.0.0" })).toBe("v2.0.0");
  });

  it("falls back to the newest entry in versions[] by indexed_at", () => {
    const game = {
      versions: [
        { id: 1, version: "v1.0.0", indexed_at: "2024-01-01T00:00:00Z" },
        { id: 2, version: "v2.0.0", indexed_at: "2024-06-01T00:00:00Z" },
        { id: 3, version: "v1.5.0", indexed_at: "2024-03-01T00:00:00Z" },
      ],
    };
    expect(resolveServerVersionTag(game)).toBe("v2.0.0");
  });

  it("breaks ties by id and ignores empty version strings", () => {
    const game = {
      versions: [
        { id: 5, version: "" },
        { id: 4, version: "v1.0.0" },
        { id: 7, version: "v1.0.0" },
      ],
    };
    expect(resolveServerVersionTag(game)).toBe("v1.0.0");
  });

  it("returns null when no version information is present", () => {
    expect(resolveServerVersionTag({})).toBeNull();
    expect(resolveServerVersionTag({ versions: [] })).toBeNull();
  });

  it("ignores a default version that belongs to another platform", () => {
    const game = {
      // The backend default is the newer Linux build …
      version: "v23896151",
      type: "LINUX_PORTABLE",
      versions: [
        {
          id: 1,
          version: "v23896151",
          type: "LINUX_PORTABLE",
          indexed_at: "2024-06-01T00:00:00Z",
        },
        // … while the Windows build has no version tag at all.
        {
          id: 2,
          version: "",
          type: "WINDOWS_PORTABLE",
          indexed_at: "2024-01-01T00:00:00Z",
        },
      ],
    };
    expect(
      resolveServerVersionTag(game, {
        versionName: "Unspecified",
        gameType: "WINDOWS_PORTABLE",
      }),
    ).toBeNull();
  });

  it("does not trust game.type when the mirror belongs to another platform", () => {
    // Installed-only cards overwrite `type` with the installed type, so the
    // mirror's platform has to come from the version list.
    const game = {
      version: "v23896151",
      type: "WINDOWS_PORTABLE",
      versions: [
        { id: 1, version: "v23896151", type: "LINUX_PORTABLE" },
        { id: 2, version: "", type: "WINDOWS_PORTABLE" },
      ],
    };
    expect(
      resolveServerVersionTag(game, {
        versionName: "Unspecified",
        gameType: "WINDOWS_PORTABLE",
      }),
    ).toBeNull();
  });

  it("picks the newest tag of the installed platform", () => {
    const game = {
      version: "v3.0.0",
      type: "LINUX_PORTABLE",
      versions: [
        {
          id: 1,
          version: "v1.0.0",
          type: "WINDOWS_PORTABLE",
          indexed_at: "2024-01-01T00:00:00Z",
        },
        {
          id: 2,
          version: "v2.0.0",
          type: "WINDOWS_PORTABLE",
          indexed_at: "2024-05-01T00:00:00Z",
        },
        {
          id: 3,
          version: "v3.0.0",
          type: "LINUX_PORTABLE",
          indexed_at: "2024-06-01T00:00:00Z",
        },
      ],
    };
    expect(
      resolveServerVersionTag(game, {
        versionName: "v1.0.0",
        gameType: "WINDOWS_PORTABLE",
      }),
    ).toBe("v2.0.0");
  });

  it("uses the installed version id to determine the platform", () => {
    const game = {
      version: "v3.0.0",
      type: "LINUX_PORTABLE",
      versions: [
        { id: 10, version: "v1.0.0", type: "WINDOWS_PORTABLE" },
        { id: 20, version: "v3.0.0", type: "LINUX_PORTABLE" },
      ],
    };
    expect(
      resolveServerVersionTag(game, { versionName: "v1.0.0", versionId: 10 }),
    ).toBe("v1.0.0");
  });
});

describe("isGameUpdateAvailable", () => {
  it("returns false when the game is not installed", () => {
    expect(isGameUpdateAvailable({ version: "v2.0.0" }, null)).toBe(false);
    expect(isGameUpdateAvailable({ version: "v2.0.0" }, undefined)).toBe(false);
  });

  it("returns false when the installed tag matches the server tag", () => {
    expect(
      isGameUpdateAvailable({ version: "v1.0.0" }, { versionName: "v1.0.0" }),
    ).toBe(false);
    // Different spelling, same version.
    expect(
      isGameUpdateAvailable({ version: "v1.0.0" }, { versionName: " 1.0.0 " }),
    ).toBe(false);
  });

  it("returns true when the server has a different default version", () => {
    expect(
      isGameUpdateAvailable({ version: "v2.0.0" }, { versionName: "v1.0.0" }),
    ).toBe(true);
  });

  it("uses the versions[] fallback when the mirror is missing", () => {
    const game = {
      versions: [
        { id: 1, version: "v1.0.0", indexed_at: "2024-01-01T00:00:00Z" },
        { id: 2, version: "v2.0.0", indexed_at: "2024-06-01T00:00:00Z" },
      ],
    };
    expect(isGameUpdateAvailable(game, { versionName: "v1.0.0" })).toBe(true);
    expect(isGameUpdateAvailable(game, { versionName: "v2.0.0" })).toBe(false);
  });

  it("returns false when either tag is unknown", () => {
    expect(
      isGameUpdateAvailable({ version: "v2.0.0" }, { versionName: "" }),
    ).toBe(false);
    expect(isGameUpdateAvailable({}, { versionName: "v1.0.0" })).toBe(false);
  });

  it("does not report an update for a version from another platform", () => {
    // Windows install, but the server's default version is the newer Linux
    // build while the Windows build has no version tag.
    const game = {
      version: "v23896151",
      type: "LINUX_PORTABLE",
      versions: [
        { id: 1, version: "v23896151", type: "LINUX_PORTABLE" },
        { id: 2, version: "", type: "WINDOWS_PORTABLE" },
      ],
    };
    expect(
      isGameUpdateAvailable(game, {
        versionName: "Unspecified",
        gameType: "WINDOWS_PORTABLE",
      }),
    ).toBe(false);
  });

  it("reports an update when the installed platform has a newer tag", () => {
    const game = {
      version: "v3.0.0",
      type: "LINUX_PORTABLE",
      versions: [
        { id: 1, version: "v1.0.0", type: "WINDOWS_PORTABLE" },
        { id: 2, version: "v2.0.0", type: "WINDOWS_PORTABLE" },
        { id: 3, version: "v3.0.0", type: "LINUX_PORTABLE" },
      ],
    };
    expect(
      isGameUpdateAvailable(game, {
        versionName: "v1.0.0",
        gameType: "WINDOWS_PORTABLE",
      }),
    ).toBe(true);
    expect(
      isGameUpdateAvailable(game, {
        versionName: "v2.0.0",
        gameType: "WINDOWS_PORTABLE",
      }),
    ).toBe(false);
  });
});
