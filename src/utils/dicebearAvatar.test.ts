import { describe, expect, it } from "vitest";
import { createDicebearAvatar } from "./dicebearAvatar";

describe("createDicebearAvatar", () => {
  it("returns a deterministic SVG data URI for the same seed", () => {
    expect(createDicebearAvatar("5")).toBe(createDicebearAvatar("5"));
  });

  it("returns different avatars for different seeds", () => {
    expect(createDicebearAvatar("1")).not.toBe(createDicebearAvatar("2"));
  });

  it("produces an svg data uri", () => {
    expect(createDicebearAvatar("abc")).toMatch(/^data:image\/svg\+xml/);
  });

  it("is stable for the same user id string", () => {
    expect(createDicebearAvatar("42")).toBe(createDicebearAvatar("42"));
  });
});
