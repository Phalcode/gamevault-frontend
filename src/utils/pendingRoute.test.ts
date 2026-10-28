// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { consumePendingDeepLink, setPendingDeepLink } from "./pendingRoute";

describe("pendingDeepLink", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("returns the stored show action exactly once", () => {
    setPendingDeepLink({ kind: "show", route: "/library/42" });
    expect(consumePendingDeepLink()).toEqual({
      kind: "show",
      route: "/library/42",
    });
    expect(consumePendingDeepLink()).toBeNull();
  });

  it("returns the stored start action exactly once", () => {
    setPendingDeepLink({ kind: "start", gameId: 42 });
    expect(consumePendingDeepLink()).toEqual({ kind: "start", gameId: 42 });
    expect(consumePendingDeepLink()).toBeNull();
  });

  it("returns null when nothing was stored", () => {
    expect(consumePendingDeepLink()).toBeNull();
  });

  it("drops a stored value that is not a valid action", () => {
    sessionStorage.setItem(
      "gv_pending_deeplink",
      JSON.stringify({ kind: "show", route: "https://evil.example" }),
    );
    expect(consumePendingDeepLink()).toBeNull();
    expect(sessionStorage.getItem("gv_pending_deeplink")).toBeNull();
  });

  it.each([
    { kind: "show", route: "//evil.example/library/42" },
    { kind: "show", route: "library/42" },
    { kind: "start", gameId: 0 },
    { kind: "start", gameId: -1 },
    { kind: "nope" },
  ])("rejects invalid action %o", (action) => {
    setPendingDeepLink(action as never);
    expect(consumePendingDeepLink()).toBeNull();
  });
});
