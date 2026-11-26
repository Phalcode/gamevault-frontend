// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  getRememberedServerUrl,
  getRememberedServerUuid,
  normalizeServerIdentityUrl,
  rememberServerUuid,
  serverIdentifiers,
} from "./serverIdentity";

const SERVER = "https://Games.Example.test/GameVault/";

describe("normalizeServerIdentityUrl", () => {
  it("normalizes origin, removes credentials/query and trailing slashes", () => {
    expect(
      normalizeServerIdentityUrl(
        "https://user:pass@Games.Example.test/GameVault/?x=1#y",
      ),
    ).toBe("https://games.example.test/GameVault");
  });

  it("returns an empty string without a URL", () => {
    expect(normalizeServerIdentityUrl()).toBe("");
    expect(normalizeServerIdentityUrl("   ")).toBe("");
  });
});

describe("server UUID memory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers a UUID per normalized server URL", () => {
    rememberServerUuid(SERVER, "uuid-a");

    expect(
      getRememberedServerUuid("https://games.example.test/GameVault"),
    ).toBe("uuid-a");
    expect(getRememberedServerUrl("uuid-a")).toBe(
      "https://games.example.test/GameVault",
    );
  });

  it("ignores empty values", () => {
    rememberServerUuid(SERVER, "   ");
    rememberServerUuid("", "uuid-a");

    expect(getRememberedServerUuid(SERVER)).toBeNull();
  });
});

describe("serverIdentifiers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the live UUID before the normalized URL", () => {
    expect(serverIdentifiers(SERVER, "uuid-a")).toEqual([
      "uuid-a",
      "https://games.example.test/GameVault",
    ]);
  });

  it("falls back to the remembered UUID when status is unavailable", () => {
    rememberServerUuid(SERVER, "uuid-a");

    expect(serverIdentifiers(SERVER)).toEqual([
      "uuid-a",
      "https://games.example.test/GameVault",
    ]);
  });

  it("deduplicates a UUID that equals the URL", () => {
    expect(
      serverIdentifiers("https://same.example", "https://same.example"),
    ).toEqual(["https://same.example"]);
  });
});
