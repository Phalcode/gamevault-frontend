// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  computeSpeedBps,
  formatBytes,
  formatKBps,
  formatLimit,
  formatSpeed,
  getSkipAutoResumeIds,
  setSkipAutoResume,
} from "./downloadFormat";

beforeEach(() => {
  localStorage.clear();
  // Deterministic locale for number formatting.
  Object.defineProperty(navigator, "language", {
    value: "en-US",
    configurable: true,
  });
});

describe("skip auto-resume bookkeeping", () => {
  it("starts empty and persists added ids", () => {
    expect(getSkipAutoResumeIds().size).toBe(0);
    setSkipAutoResume(7, true);
    setSkipAutoResume(9, true);
    expect([...getSkipAutoResumeIds()].sort()).toEqual([7, 9]);
  });

  it("removes an id and ignores invalid ids", () => {
    setSkipAutoResume(7, true);
    setSkipAutoResume(7, false);
    expect(getSkipAutoResumeIds().has(7)).toBe(false);
    // <= 0 ids are ignored.
    setSkipAutoResume(0, true);
    setSkipAutoResume(-3, true);
    expect(getSkipAutoResumeIds().size).toBe(0);
  });

  it("recovers from corrupt storage", () => {
    localStorage.setItem("skip_auto_resume_downloads", "{not json");
    expect(getSkipAutoResumeIds().size).toBe(0);
  });
});

describe("computeSpeedBps", () => {
  it("returns undefined when there are no samples", () => {
    expect(computeSpeedBps([], 300, 2000)).toBeUndefined();
  });

  it("returns undefined when the window has not elapsed", () => {
    expect(
      computeSpeedBps([{ t: 2000, bytes: 100 }], 300, 2000),
    ).toBeUndefined();
  });

  it("computes bytes-per-second over the sample window", () => {
    const samples = [
      { t: 1000, bytes: 100 },
      { t: 2000, bytes: 200 },
    ];
    expect(computeSpeedBps(samples, 300, 2000)).toBe(200);
  });
});

describe("formatBytes", () => {
  it("handles zero, negative, and non-finite", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(NaN)).toBe("0 B");
  });

  it("keeps bytes for sub-KB values", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales to KB/MB/GB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

describe("formatSpeed", () => {
  it("returns empty for missing/invalid values", () => {
    expect(formatSpeed()).toBe("");
    expect(formatSpeed(undefined)).toBe("");
    expect(formatSpeed(NaN)).toBe("");
  });

  it("uses B/s below 1000 and scales beyond", () => {
    expect(formatSpeed(500)).toBe("500 B/s");
    expect(formatSpeed(1500)).toBe("1.5 KB/s");
    expect(formatSpeed(1_500_000)).toBe("1.5 MB/s");
  });
});

describe("formatKBps", () => {
  it("returns 0 KB/s for invalid or non-positive", () => {
    expect(formatKBps()).toBe("0 KB/s");
    expect(formatKBps(NaN)).toBe("0 KB/s");
    expect(formatKBps(0)).toBe("0 KB/s");
  });

  it("formats a positive value", () => {
    expect(formatKBps(1500)).toBe("1.5 KB/s");
  });
});

describe("formatLimit", () => {
  it("returns Unlimited for zero or negative", () => {
    expect(formatLimit(0)).toBe("Unlimited");
    expect(formatLimit(-1)).toBe("Unlimited");
  });

  it("scales to KB/s and MB/s", () => {
    expect(formatLimit(500)).toBe("500 KB/s");
    expect(formatLimit(1500)).toBe("1.5 MB/s");
  });
});
