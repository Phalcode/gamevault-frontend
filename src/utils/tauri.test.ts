// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  isDebugTauriOverride,
  isTauriApp,
  isTauriDesktop,
  setDebugTauriOverride,
} from "./tauri";

const DEBUG_OVERRIDE_KEY = "gv_debug_tauri_mode";

describe("tauri detection", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("is not a Tauri app on the web by default", () => {
    expect(isTauriDesktop()).toBe(false);
    expect(isTauriApp()).toBe(false);
  });

  it("detects a real Tauri webview via __TAURI_INTERNALS__", () => {
    (window as any).__TAURI_INTERNALS__ = {};
    expect(isTauriDesktop()).toBe(true);
    expect(isTauriApp()).toBe(true);
  });

  it("round-trips the debug desktop override", () => {
    expect(isDebugTauriOverride()).toBe(false);
    setDebugTauriOverride(true);
    expect(isDebugTauriOverride()).toBe(true);
    expect(isTauriApp()).toBe(true);
    setDebugTauriOverride(false);
    expect(isDebugTauriOverride()).toBe(false);
    expect(isTauriApp()).toBe(false);
  });
});
