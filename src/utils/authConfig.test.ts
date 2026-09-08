import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDevAutologinConfig, normalizeServerUrl } from "./authConfig";

beforeEach(() => {
  vi.stubEnv("VITE_DEV_AUTOLOGIN", "");
  vi.stubEnv("VITE_DEV_AUTOLOGIN_SERVER", "");
  vi.stubEnv("VITE_DEV_AUTOLOGIN_USERNAME", "");
  vi.stubEnv("VITE_DEV_AUTOLOGIN_PASSWORD", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("normalizeServerUrl", () => {
  it("returns empty for blank input", () => {
    expect(normalizeServerUrl("")).toBe("");
    expect(normalizeServerUrl("   ")).toBe("");
  });

  it("adds https:// when no scheme is present", () => {
    expect(normalizeServerUrl("example.com")).toBe("https://example.com");
  });

  it("keeps an existing http/https scheme and strips trailing slashes", () => {
    expect(normalizeServerUrl("http://example.com/")).toBe("http://example.com");
    expect(normalizeServerUrl("https://demo.gamevau.lt///")).toBe(
      "https://demo.gamevau.lt",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  example.com  ")).toBe("https://example.com");
  });
});

describe("getDevAutologinConfig", () => {
  it("returns null when autologin is disabled", () => {
    expect(getDevAutologinConfig()).toBeNull();
  });

  it("returns config when enabled and all fields present", () => {
    vi.stubEnv("VITE_DEV_AUTOLOGIN", "true");
    vi.stubEnv("VITE_DEV_AUTOLOGIN_SERVER", "example.com");
    vi.stubEnv("VITE_DEV_AUTOLOGIN_USERNAME", "demo");
    vi.stubEnv("VITE_DEV_AUTOLOGIN_PASSWORD", "pass");
    expect(getDevAutologinConfig()).toEqual({
      server: "https://example.com",
      username: "demo",
      password: "pass",
    });
  });
});
