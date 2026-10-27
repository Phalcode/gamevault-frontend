// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { hasOpenOverlay, isEditableTarget } from "./overlay";

describe("hasOpenOverlay", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns false when nothing is open", () => {
    expect(hasOpenOverlay()).toBe(false);
  });

  it("returns true when a headless-ui element is open", () => {
    document.body.innerHTML = '<div data-headlessui-state="open"></div>';
    expect(hasOpenOverlay()).toBe(true);
  });

  it("returns true when a dialog is present", () => {
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(hasOpenOverlay()).toBe(true);
  });
});

describe("isEditableTarget", () => {
  it("detects editable form controls", () => {
    expect(isEditableTarget({ target: document.createElement("input") } as any)).toBe(true);
    expect(isEditableTarget({ target: document.createElement("textarea") } as any)).toBe(true);
    expect(isEditableTarget({ target: document.createElement("select") } as any)).toBe(true);
    // jsdom does not implement isContentEditable; a plain div is not editable.
    expect(isEditableTarget({ target: document.createElement("div") } as any)).toBeFalsy();
  });
});
