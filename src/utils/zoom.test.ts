// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adjustZoom,
  clampZoom,
  DEFAULT_ZOOM,
  getStoredZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  resetZoomLevel,
  zoomPercent,
} from "./zoom";

const STORAGE_KEY = "gv_zoom_level";

describe("zoom", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.zoom = "";
  });

  it("clamps to the allowed range and handles NaN", () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(3)).toBe(MAX_ZOOM);
    expect(clampZoom(1.2)).toBe(1.2);
    expect(clampZoom(NaN)).toBe(DEFAULT_ZOOM);
  });

  it("reads the stored zoom, clamping and falling back to 1", () => {
    expect(getStoredZoom()).toBe(DEFAULT_ZOOM);
    localStorage.setItem(STORAGE_KEY, "1.5");
    expect(getStoredZoom()).toBe(1.5);
    localStorage.setItem(STORAGE_KEY, "9");
    expect(getStoredZoom()).toBe(MAX_ZOOM);
    localStorage.setItem(STORAGE_KEY, "not-a-number");
    expect(getStoredZoom()).toBe(DEFAULT_ZOOM);
  });

  it("converts zoom to a percent", () => {
    expect(zoomPercent(1)).toBe(100);
    expect(zoomPercent(0.5)).toBe(50);
    expect(zoomPercent(1.234)).toBe(123);
  });

  it("adjusts relative to the current stored zoom and clamps", () => {
    localStorage.setItem(STORAGE_KEY, "1.9");
    const next = adjustZoom(0.2);
    expect(next).toBe(MAX_ZOOM);
  });

  it("resets to the default zoom", () => {
    localStorage.setItem(STORAGE_KEY, "1.5");
    expect(resetZoomLevel()).toBe(DEFAULT_ZOOM);
  });
});
