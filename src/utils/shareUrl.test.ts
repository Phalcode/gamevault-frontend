// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildShareUrl } from "./shareUrl";

describe("buildShareUrl", () => {
  it("anchors the route to the configured GameVault server", () => {
    expect(buildShareUrl("https://games.example.com", "/library/2341")).toBe(
      "https://games.example.com/library/2341",
    );
  });

  it("strips trailing slashes from the server url", () => {
    expect(buildShareUrl("https://games.example.com///", "/library/2341")).toBe(
      "https://games.example.com/library/2341",
    );
  });

  it("adds a missing scheme and leading slash", () => {
    expect(buildShareUrl("games.example.com", "library/2341")).toBe(
      "https://games.example.com/library/2341",
    );
  });

  it("preserves query string and hash of the route", () => {
    expect(
      buildShareUrl("https://games.example.com", "/library?q=zelda#top"),
    ).toBe("https://games.example.com/library?q=zelda#top");
  });

  it("ignores the tauri.localhost origin and never uses it for links", () => {
    expect(
      buildShareUrl("https://games.example.com", "/library/2341"),
    ).not.toContain("tauri.localhost");
  });

  it("falls back to the current window origin when no server is set", () => {
    expect(buildShareUrl("", "/library/2341")).toBe(
      `${window.location.origin}/library/2341`,
    );
    expect(buildShareUrl(null, "/library/2341")).toBe(
      `${window.location.origin}/library/2341`,
    );
  });
});
