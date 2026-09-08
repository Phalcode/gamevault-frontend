// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  channelLabel,
  clearSkippedVersion,
  compareVersions,
  defaultChannelForBuild,
  formatReleaseNotes,
  formatUpdateError,
  formatUpdatePrompt,
  isMissingUpdaterFeedError,
  normalizeVersion,
  readSkippedVersion,
  readUpdateChannel,
  writeSkippedVersion,
  writeUpdateChannel,
} from "./updater";

beforeEach(() => {
  localStorage.clear();
});

describe("normalizeVersion", () => {
  it("strips a leading v and trims", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(normalizeVersion("  1.2.3  ")).toBe("1.2.3");
  });
});

describe("compareVersions", () => {
  it("orders numeric segments", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("treats missing segments as zero and ignores pre-release labels", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.3-beta", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });
});

describe("formatReleaseNotes", () => {
  it("handles empty/null input", () => {
    expect(formatReleaseNotes()).toBe("");
    expect(formatReleaseNotes(null)).toBe("");
    expect(formatReleaseNotes("   ")).toBe("");
  });

  it("collapses whitespace and truncates long notes", () => {
    expect(formatReleaseNotes("a\n\nb")).toBe("a b");
    const long = "x".repeat(300);
    const result = formatReleaseNotes(long);
    expect(result).toBe("x".repeat(237) + "...");
  });
});

describe("formatUpdatePrompt", () => {
  it("includes version, channel, and confirmation question", () => {
    const prompt = formatUpdatePrompt("2.0.0", "stable");
    expect(prompt).toContain("You are running GameVault v");
    expect(prompt).toContain("GameVault v2.0.0 is available on the stable channel");
    expect(prompt).toContain("Do you want to download and install this update now?");
  });

  it("appends release notes when present", () => {
    const prompt = formatUpdatePrompt("2.0.0", "unstable", "Great new stuff");
    expect(prompt).toContain("Release notes: Great new stuff");
  });
});

describe("formatUpdateError", () => {
  it("unwraps messages or falls back", () => {
    expect(formatUpdateError(new Error("boom"))).toBe("boom");
    expect(formatUpdateError("oops")).toBe("oops");
    expect(formatUpdateError("")).toBe("GameVault could not complete the update check.");
    expect(formatUpdateError(null)).toBe("GameVault could not complete the update check.");
  });
});

describe("channelLabel", () => {
  it("is the identity", () => {
    expect(channelLabel("stable")).toBe("stable");
    expect(channelLabel("early-access")).toBe("early-access");
  });
});

describe("skipped update version", () => {
  it("stores and clears per channel", () => {
    writeSkippedVersion("stable", "1.0.0");
    expect(readSkippedVersion("stable")).toBe("1.0.0");
    expect(readSkippedVersion("unstable")).toBeNull();
    clearSkippedVersion("stable");
    expect(readSkippedVersion("stable")).toBeNull();
  });
});

describe("update channel persistence", () => {
  it("falls back to the build default when unset or invalid", () => {
    expect(defaultChannelForBuild()).toBe("stable");
    expect(readUpdateChannel()).toBe("stable");
    localStorage.setItem("gv_update_channel", "bogus");
    expect(readUpdateChannel()).toBe("stable");
  });

  it("persists a valid channel", () => {
    writeUpdateChannel("early-access");
    expect(readUpdateChannel()).toBe("early-access");
  });
});

describe("isMissingUpdaterFeedError", () => {
  it("detects missing feed errors", () => {
    expect(isMissingUpdaterFeedError(new Error("404 Not Found"))).toBe(true);
    expect(isMissingUpdaterFeedError("target not found")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isMissingUpdaterFeedError(new Error("network down"))).toBe(false);
  });
});
