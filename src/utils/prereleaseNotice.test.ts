// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRERELEASE_NOTICE_KEY,
  isPrereleaseChannel,
  markPrereleaseNoticeSeen,
  prereleaseChannelOfBuild,
  prereleaseNoticeContent,
  shouldShowPrereleaseNotice,
} from "./prereleaseNotice";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

/** Pretend the page runs inside the desktop app's webview. */
function simulateDesktopApp(): void {
  (window as any).__TAURI_INTERNALS__ = {};
}

/**
 * Minimal stand-in for the native settings file: it remembers the acknowledged
 * channel across an update that wipes the webview's localStorage.
 */
function mockNativeSettings(initial: string | null) {
  let stored = initial;
  invokeMock.mockImplementation(
    (command: string, args?: { channel?: string }) => {
      if (command === "set_prerelease_notice_channel") {
        stored = args?.channel ?? null;
        return Promise.resolve(undefined);
      }
      return Promise.resolve(stored);
    },
  );
  return { read: () => stored };
}

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  delete (window as any).__TAURI_INTERNALS__;
});

describe("isPrereleaseChannel", () => {
  it("treats early-access and unstable as pre-release channels", () => {
    expect(isPrereleaseChannel("early-access")).toBe(true);
    expect(isPrereleaseChannel("unstable")).toBe(true);
  });

  it("treats stable as a regular channel", () => {
    expect(isPrereleaseChannel("stable")).toBe(false);
  });
});

describe("prereleaseChannelOfBuild", () => {
  it("returns null for builds without a pre-release channel", () => {
    // Tests run with __BUILD_CHANNEL__ = "dev", which is not a pre-release.
    expect(prereleaseChannelOfBuild()).toBeNull();
  });
});

describe("shouldShowPrereleaseNotice (web build)", () => {
  it("shows the notice until that channel has been acknowledged", async () => {
    expect(await shouldShowPrereleaseNotice("unstable")).toBe(true);

    await markPrereleaseNoticeSeen("unstable");
    expect(await shouldShowPrereleaseNotice("unstable")).toBe(false);
    // The other pre-release channel has its own, unrelated warning.
    expect(await shouldShowPrereleaseNotice("early-access")).toBe(true);
    expect(localStorage.getItem(PRERELEASE_NOTICE_KEY)).toBe("unstable");
  });
});

describe("shouldShowPrereleaseNotice (desktop app)", () => {
  it("stays acknowledged when an update wipes the webview storage", async () => {
    simulateDesktopApp();
    const native = mockNativeSettings("unstable");

    // The app settings file survived the update, the webview data did not.
    expect(localStorage.getItem(PRERELEASE_NOTICE_KEY)).toBeNull();
    expect(await shouldShowPrereleaseNotice("unstable")).toBe(false);
    expect(native.read()).toBe("unstable");
  });

  it("keeps warning about a channel that was never acknowledged", async () => {
    simulateDesktopApp();
    mockNativeSettings("unstable");

    expect(await shouldShowPrereleaseNotice("early-access")).toBe(true);
  });

  it("writes the acknowledgement into the app settings", async () => {
    simulateDesktopApp();
    const native = mockNativeSettings(null);

    expect(await shouldShowPrereleaseNotice("early-access")).toBe(true);

    await markPrereleaseNoticeSeen("early-access");
    expect(native.read()).toBe("early-access");
    expect(invokeMock).toHaveBeenCalledWith("set_prerelease_notice_channel", {
      channel: "early-access",
    });
    expect(await shouldShowPrereleaseNotice("early-access")).toBe(false);
  });

  it("adopts an acknowledgement recorded by an older build", async () => {
    simulateDesktopApp();
    localStorage.setItem(PRERELEASE_NOTICE_KEY, "unstable");
    const native = mockNativeSettings(null);

    expect(await shouldShowPrereleaseNotice("unstable")).toBe(false);
    expect(native.read()).toBe("unstable");
  });

  it("falls back to localStorage when the native settings fail", async () => {
    simulateDesktopApp();
    localStorage.setItem(PRERELEASE_NOTICE_KEY, "unstable");
    invokeMock.mockRejectedValue(new Error("no native settings"));

    expect(await shouldShowPrereleaseNotice("unstable")).toBe(false);
    expect(await shouldShowPrereleaseNotice("early-access")).toBe(true);
  });
});

describe("prereleaseNoticeContent", () => {
  it("warns unstable users about development builds", () => {
    const { title, description } = prereleaseNoticeContent(
      "unstable",
      "17.1.0-unstable.42.1",
    );
    expect(title).toContain("unstable");
    expect(description).toContain("17.1.0-unstable.42.1");
    expect(description).toContain("developers and testers");
    expect(description).toContain("additional setup steps may be necessary");
    expect(description).toContain("Stable update channel");
  });

  it("warns Early Access users about the program", () => {
    const { title, description } = prereleaseNoticeContent(
      "early-access",
      "17.1.0-ea.7.2",
    );
    expect(title).toContain("Early Access");
    expect(description).toContain("17.1.0-ea.7.2");
    expect(description).toContain("early access program");
    expect(description).toContain("additional setup steps may be necessary");
    expect(description).toContain("Stable update channel");
  });
});
