// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countBucket,
  durationBucket,
  isAnalyticsEnabled,
  normalizeRoute,
  progressBucket,
  setAnalyticsEnabled,
  sizeBucket,
} from "./analytics";

vi.mock("swetrix", () => ({
  init: vi.fn(),
  track: vi.fn(),
  trackViews: vi.fn(() => Promise.resolve({ stop: vi.fn() })),
  trackErrors: vi.fn(() => ({ stop: vi.fn() })),
  startSessionReplay: vi.fn(() =>
    Promise.resolve({ stop: vi.fn(), flush: vi.fn() }),
  ),
}));

const ANALYTICS_CONSENT_KEY = "app_analytics_consent";

describe("analytics consent", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to true (opt-out) when no preference is stored", () => {
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("returns true when consent is stored as '1'", () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "1");
    expect(isAnalyticsEnabled()).toBe(true);
  });

  it("returns false when consent is stored as '0'", () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "0");
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("round-trips via setAnalyticsEnabled", async () => {
    await setAnalyticsEnabled(false);
    expect(isAnalyticsEnabled()).toBe(false);
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("0");
    await setAnalyticsEnabled(true);
    expect(isAnalyticsEnabled()).toBe(true);
  });
});

describe("route normalization", () => {
  it("collapses game and profile ids", () => {
    expect(normalizeRoute("/library/42")).toBe("/library/game");
    expect(normalizeRoute("/library/42?tab=notes")).toBe("/library/game");
    expect(normalizeRoute("/community/7")).toBe("/community/profile");
    expect(normalizeRoute("/library")).toBe("/library");
    expect(normalizeRoute("/")).toBe("/");
  });
});

describe("buckets", () => {
  it("buckets sizes without leaking exact values", () => {
    expect(sizeBucket(0)).toBe("unknown");
    expect(sizeBucket(50 * 1024 * 1024)).toBe("lt_100mb");
    expect(sizeBucket(2 * 1024 * 1024 * 1024)).toBe("1gb_5gb");
    expect(sizeBucket(50 * 1024 * 1024 * 1024)).toBe("gt_20gb");
  });

  it("buckets durations", () => {
    expect(durationBucket(500)).toBe("lt_10s");
    expect(durationBucket(30_000)).toBe("10s_1min");
    expect(durationBucket(2 * 60 * 60 * 1000)).toBe("gt_1h");
  });

  it("buckets counts and progress", () => {
    expect(countBucket(0)).toBe("0");
    expect(countBucket(42)).toBe("10_99");
    expect(countBucket(50_000)).toBe("gt_10k");
    expect(progressBucket(10)).toBe("0_25");
    expect(progressBucket(100)).toBe("100");
  });
});

describe("collector selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses the first collector that answers", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(new Response("{}", { status: 400 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const Swetrix = await import("swetrix");
    const analytics = await import("./analytics");
    await analytics.initAnalytics();

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.swetrix.com/log");
    expect(Swetrix.init).toHaveBeenCalledWith(
      "dBl2xaaJ9x3M",
      expect.objectContaining({ apiURL: "https://api.swetrix.com/log" }),
    );
  });

  it("falls back to the next collector when one is unreachable", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const fetchMock = vi.fn((url: string) =>
      url.startsWith("https://api.swetrix.com")
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(new Response("{}", { status: 400 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const Swetrix = await import("swetrix");
    const analytics = await import("./analytics");
    await analytics.initAnalytics();

    expect(Swetrix.init).toHaveBeenCalledWith(
      "dBl2xaaJ9x3M",
      expect.objectContaining({
        apiURL: "https://analytics.platform.phalco.de/log",
      }),
    );
  });

  it("keeps tracking off when no collector answers", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );

    const Swetrix = await import("swetrix");
    const analytics = await import("./analytics");
    await analytics.initAnalytics();

    expect(Swetrix.init).not.toHaveBeenCalled();
  });
});
