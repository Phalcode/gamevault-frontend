import { describe, expect, it } from "vitest";
import {
  isGameUpdateAvailable,
  normalizeVersionTag,
  resolveServerVersionTag,
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
});
