// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildArchivePasswordCandidates,
  getArchivePasswordStorageKey,
  loadArchivePasswords,
  normalizeArchivePasswords,
  saveArchivePasswords,
} from "./archivePasswords";

const SCOPE = { serverUrl: "https://games.example.com", userId: 7 };

describe("normalizeArchivePasswords", () => {
  it("trims, drops empty entries and duplicates, keeping the order", () => {
    expect(
      normalizeArchivePasswords([" hunter2 ", "hunter2", "", "  ", "other"]),
    ).toEqual(["hunter2", "other"]);
  });

  it("keeps passwords case-sensitive", () => {
    expect(normalizeArchivePasswords(["Secret", "secret"])).toEqual([
      "Secret",
      "secret",
    ]);
  });
});

describe("buildArchivePasswordCandidates", () => {
  it("tries the typed password before the saved ones", () => {
    expect(
      buildArchivePasswordCandidates("typed", ["first", "second"]),
    ).toEqual(["typed", "first", "second"]);
  });

  it("does not repeat a typed password that is already saved", () => {
    expect(
      buildArchivePasswordCandidates("first", ["first", "second"]),
    ).toEqual(["first", "second"]);
  });

  it("ignores an empty typed password", () => {
    expect(buildArchivePasswordCandidates("  ", ["first"])).toEqual(["first"]);
    expect(buildArchivePasswordCandidates(undefined, [])).toEqual([]);
  });
});

describe("archive password storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("scopes the key per server and account without exposing the server URL", () => {
    const key = getArchivePasswordStorageKey(SCOPE);
    const otherUser = getArchivePasswordStorageKey({ ...SCOPE, userId: 8 });
    const otherServer = getArchivePasswordStorageKey({
      ...SCOPE,
      serverUrl: "https://other.example.com",
    });

    expect(key).toBeTruthy();
    expect(key).not.toContain("games.example.com");
    expect(key).not.toBe(otherUser);
    expect(key).not.toBe(otherServer);
  });

  it("returns no key without a server or account", () => {
    expect(
      getArchivePasswordStorageKey({ serverUrl: "", userId: 7 }),
    ).toBeNull();
    expect(
      getArchivePasswordStorageKey({
        serverUrl: SCOPE.serverUrl,
        userId: null,
      }),
    ).toBeNull();
  });

  it("round-trips the list for the current scope", async () => {
    await saveArchivePasswords(SCOPE, [" one ", "two", "one"]);

    expect(await loadArchivePasswords(SCOPE)).toEqual(["one", "two"]);
    expect(
      await loadArchivePasswords({ ...SCOPE, serverUrl: "https://other.test" }),
    ).toEqual([]);
    expect(await loadArchivePasswords({ ...SCOPE, userId: 8 })).toEqual([]);
  });

  it("ignores corrupt stored data", async () => {
    const key = getArchivePasswordStorageKey(SCOPE);
    localStorage.setItem(key!, "{not json");

    expect(await loadArchivePasswords(SCOPE)).toEqual([]);
  });
});
