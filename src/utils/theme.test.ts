// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getStoredTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as any;
});

describe("getStoredTheme", () => {
  it("returns dark/light from the stored boolean string", () => {
    localStorage.setItem("darkMode", "true");
    expect(getStoredTheme()).toBe("dark");
    localStorage.setItem("darkMode", "false");
    expect(getStoredTheme()).toBe("light");
  });

  it("defaults to system when missing", () => {
    expect(getStoredTheme()).toBe("system");
  });
});

describe("applyTheme", () => {
  it("toggles the dark class and persists an explicit choice", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("darkMode")).toBe("true");
    const evt = spy.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === "darkMode",
    );
    expect((evt?.[0] as CustomEvent).detail).toEqual({ darkMode: true });
  });

  it("removes the storage key when set to system", () => {
    localStorage.setItem("darkMode", "true");
    applyTheme("system");
    expect(localStorage.getItem("darkMode")).toBeNull();
    // matchMedia returns matches: true, so dark class is applied.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not persist when persist is false", () => {
    applyTheme("light", false);
    expect(localStorage.getItem("darkMode")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
