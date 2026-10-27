// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  getStreamerMode,
  maskDisplayName,
  maskEmail,
  maskHandle,
  maskUrl,
  maskUser,
  registerStreamerModeHotkey,
} from "./streamerMode";

describe("maskDisplayName", () => {
  it("is deterministic for the same seed", () => {
    expect(maskDisplayName("1")).toBe(maskDisplayName("1"));
    expect(maskDisplayName("42")).toBe(maskDisplayName("42"));
  });

  it("returns 'Anonymous' for an empty/undefined seed", () => {
    expect(maskDisplayName("")).toBe("Anonymous");
    expect(maskDisplayName(undefined as unknown as string)).toBe("Anonymous");
  });

  it("produces different stand-ins for different user ids", () => {
    const names = new Set(
      ["1", "2", "3", "4", "5", "6", "7", "8"].map((id) =>
        maskDisplayName(id),
      ),
    );
    // The adjective+animal space is huge, so collisions are virtually
    // impossible; all stand-ins should be distinct and look like a name.
    expect(names.size).toBe(8);
    for (const name of names) {
      expect(name.trim()).not.toBe("");
      expect(name).toMatch(/^\S+ \S+$/);
    }
  });

  it("lines up with the handle and email (same adjective + animal)", () => {
    const seed = "5";
    const display = maskDisplayName(seed);
    const handle = maskHandle(seed);
    expect(display.toLowerCase().replace(" ", "_")).toBe(handle);
    expect(maskEmail(seed)).toBe(`${handle}@masked.example`);
  });

  it("treats the numeric id string the same as the number", () => {
    expect(maskDisplayName("7")).toBe(maskDisplayName(7));
  });
});

describe("maskHandle", () => {
  it("is deterministic for the same seed", () => {
    expect(maskHandle("3")).toBe(maskHandle("3"));
  });

  it("returns '_anon' for an empty seed", () => {
    expect(maskHandle("")).toBe("_anon");
    expect(maskHandle(undefined as unknown as string)).toBe("_anon");
  });

  it("returns a lower-case underscore-joined handle", () => {
    expect(maskHandle("4")).toMatch(/^[a-z]+_[a-z]+$/);
  });
});

describe("maskEmail", () => {
  it("always uses the masked domain and never leaks a real one", () => {
    expect(maskEmail("1")).toMatch(/@masked\.example$/);
    expect(maskEmail("1")).toBe(maskEmail("1"));
  });

  it("returns '' for an empty seed", () => {
    expect(maskEmail("")).toBe("");
    expect(maskEmail(undefined as unknown as string)).toBe("");
  });

  it("derives the local part from the handle", () => {
    const seed = "5";
    expect(maskEmail(seed)).toBe(`${maskHandle(seed)}@masked.example`);
  });
});

describe("maskUrl", () => {
  it("returns the placeholder server url for a real url and '' otherwise", () => {
    expect(maskUrl("https://real.server")).toBe("https://my.secret.server");
    expect(maskUrl("")).toBe("");
  });
});

describe("maskUser", () => {
  it("masks every identifier consistently from the user id", () => {
    const user = { id: 12 };
    const first = maskUser(user);
    const second = maskUser({ id: 12 });
    expect(first).toEqual(second);
    expect(first.displayName).not.toBe("");
    expect(first.handle).not.toBe("");
    expect(first.email).toBe(`${first.handle}@masked.example`);
  });

  it("falls back to anonymous values when the user has no id", () => {
    const masked = maskUser({ id: undefined });
    expect(masked.displayName).toBe("Anonymous");
    expect(masked.handle).toBe("_anon");
    expect(masked.email).toBe("");
  });

  it("treats id 0 as a valid (empty) seed, not as anonymous", () => {
    const masked = maskUser({ id: 0 });
    expect(masked.displayName).not.toBe("Anonymous");
  });
});

describe("registerStreamerModeHotkey", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("toggles streamer mode on Ctrl+Shift+O", () => {
    const off = registerStreamerModeHotkey();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "o",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(getStreamerMode()).toBe(true);
    off();
  });

  it("does not toggle without the modifier combination", () => {
    const off = registerStreamerModeHotkey();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", cancelable: true }),
    );
    expect(getStreamerMode()).toBe(false);
    off();
  });
});
