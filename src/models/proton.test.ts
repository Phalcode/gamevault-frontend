import { describe, expect, it } from "vitest";
import {
  PROTON_AUTOMATIC,
  PROTON_CODENAMES,
  protonBuildSourceLabel,
} from "./proton";

describe("protonBuildSourceLabel", () => {
  it("labels the Steam compatibilitytools.d folder", () => {
    expect(
      protonBuildSourceLabel(
        "/home/user/.local/share/Steam/compatibilitytools.d",
      ),
    ).toBe("Steam");
  });

  it("labels the older ~/.steam locations", () => {
    expect(
      protonBuildSourceLabel("/home/user/.steam/steam/compatibilitytools.d"),
    ).toBe("Steam");
    expect(
      protonBuildSourceLabel("/home/user/.steam/root/compatibilitytools.d"),
    ).toBe("Steam");
  });

  it("prefers the Flatpak label over the Steam fallback", () => {
    expect(
      protonBuildSourceLabel(
        "/home/user/.var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d",
      ),
    ).toBe("Steam (Flatpak)");
  });

  it("labels umu's own folder", () => {
    expect(
      protonBuildSourceLabel(
        "/home/user/.local/share/umu/compatibilitytools.d",
      ),
    ).toBe("umu");
  });

  it("falls back to the last path segment of unknown folders", () => {
    expect(protonBuildSourceLabel("/opt/games/protons")).toBe("protons");
  });

  it("handles Windows separators", () => {
    expect(
      protonBuildSourceLabel(
        "C:\\Users\\u\\.steam\\root\\compatibilitytools.d",
      ),
    ).toBe("Steam");
  });

  it("handles missing sources", () => {
    expect(protonBuildSourceLabel(undefined)).toBe("compatibilitytools.d");
    expect(protonBuildSourceLabel("")).toBe("compatibilitytools.d");
  });
});

describe("PROTON_CODENAMES", () => {
  it("offers umu's automatic default first", () => {
    expect(PROTON_CODENAMES[0]).toBe(PROTON_AUTOMATIC);
    expect(PROTON_CODENAMES).toContain("GE-Proton");
  });
});
