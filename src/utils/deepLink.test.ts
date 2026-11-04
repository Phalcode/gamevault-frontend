import { describe, expect, it } from "vitest";
import { isDeepLinkAction, parseDeepLink } from "./deepLink";

describe("parseDeepLink", () => {
  it("maps the show command to the game view route", () => {
    expect(parseDeepLink("gamevault://show?gameid=42")).toEqual({
      kind: "show",
      route: "/library/42",
    });
  });

  it("maps the start command to a launch action", () => {
    expect(parseDeepLink("gamevault://start?gameid=42")).toEqual({
      kind: "start",
      gameId: 42,
    });
  });

  it("accepts the path form of the command", () => {
    expect(parseDeepLink("gamevault:///show?gameid=42")).toEqual({
      kind: "show",
      route: "/library/42",
    });
  });

  it("accepts the legacy gameID parameter name", () => {
    expect(parseDeepLink("gamevault://start?gameID=7")).toEqual({
      kind: "start",
      gameId: 7,
    });
  });

  it("trims the id", () => {
    expect(parseDeepLink("gamevault://show?gameid=%2042%20")).toEqual({
      kind: "show",
      route: "/library/42",
    });
  });

  it.each([
    ["wrong scheme", "https://show?gameid=42"],
    ["unknown command", "gamevault://open?gameid=42"],
    ["missing command", "gamevault:?gameid=42"],
    ["missing id", "gamevault://show"],
    ["start without id", "gamevault://start"],
    ["start with bad id", "gamevault://start?gameid=abc"],
    ["zero id", "gamevault://show?gameid=0"],
    ["negative id", "gamevault://show?gameid=-1"],
    ["fractional id", "gamevault://show?gameid=1.5"],
    ["non-numeric id", "gamevault://show?gameid=abc"],
    ["out-of-range id", "gamevault://show?gameid=99999999999999999999"],
    ["not a url", "definitely not a url"],
  ])("ignores %s", (_label, url) => {
    expect(parseDeepLink(url)).toBeNull();
  });
});

describe("isDeepLinkAction", () => {
  it.each([
    [{ kind: "show", route: "/library/1" }, true],
    [{ kind: "start", gameId: 1 }, true],
    [{ kind: "show", route: "//evil.example/library/1" }, false],
    [{ kind: "show", route: "https://evil.example" }, false],
    [{ kind: "show", route: "library/1" }, false],
    [{ kind: "start", gameId: 0 }, false],
    [{ kind: "start", gameId: 1.5 }, false],
    [{ kind: "start", gameId: "1" }, false],
    [{ kind: "nope" }, false],
    [{}, false],
    [null, false],
    ["gamevault://show?gameid=1", false],
  ])("validates %o -> %s", (value, expected) => {
    expect(isDeepLinkAction(value)).toBe(expected);
  });
});
