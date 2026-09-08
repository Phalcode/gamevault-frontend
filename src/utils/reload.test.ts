// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerReloadHotkey } from "./reload";

let cleanups: (() => void)[] = [];

beforeEach(() => {
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((off) => off());
});

function register() {
  const off = registerReloadHotkey();
  cleanups.push(off);
  return off;
}

describe("registerReloadHotkey", () => {
  it("prevents default on a plain F5 keydown", () => {
    register();
    const event = new KeyboardEvent("keydown", { key: "F5", cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores F5 when a modifier is held", () => {
    register();
    const event = new KeyboardEvent("keydown", {
      key: "F5",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores other keys", () => {
    register();
    const event = new KeyboardEvent("keydown", { key: "F2", cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("returns a cleanup that removes the listener", () => {
    const off = register();
    off();
    const event = new KeyboardEvent("keydown", { key: "F5", cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

