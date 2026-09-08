// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { isAnalyticsEnabled, setAnalyticsEnabled } from "./analytics";

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

  it("round-trips via setAnalyticsEnabled", () => {
    setAnalyticsEnabled(false);
    expect(isAnalyticsEnabled()).toBe(false);
    setAnalyticsEnabled(true);
    expect(isAnalyticsEnabled()).toBe(true);
  });
});
