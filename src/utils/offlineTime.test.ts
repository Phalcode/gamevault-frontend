import { describe, expect, it } from "vitest";
import { offlineTimeBelongsToServer } from "./offlineTime";

const current = ["uuid-a", "https://a.example"];

describe("offlineTimeBelongsToServer", () => {
  it("matches a file tagged with the current UUID", () => {
    expect(
      offlineTimeBelongsToServer(
        {
          userId: 1,
          serverUrl: null,
          serverIdentifiers: ["uuid-a"],
        },
        current,
        1,
      ),
    ).toBe(true);
  });

  it("matches a legacy file by its raw server URL", () => {
    expect(
      offlineTimeBelongsToServer(
        { userId: 1, serverUrl: "https://A.Example/" },
        current,
        1,
      ),
    ).toBe(true);
  });

  it("keeps playtime for another server out of the current replay", () => {
    expect(
      offlineTimeBelongsToServer(
        {
          userId: 1,
          serverUrl: "https://b.example",
          serverIdentifiers: ["uuid-b"],
        },
        current,
        1,
      ),
    ).toBe(false);
  });

  it("keeps offline playtime for another account", () => {
    expect(
      offlineTimeBelongsToServer(
        { userId: 2, serverIdentifiers: ["uuid-a"] },
        current,
        1,
      ),
    ).toBe(false);
  });

  it("replays legacy files without server markers against the current server", () => {
    expect(offlineTimeBelongsToServer({ userId: 1 }, current, 1)).toBe(true);
  });

  it("replays a legacy file without a user id against the current account", () => {
    expect(
      offlineTimeBelongsToServer(
        { userId: 0, serverIdentifiers: ["uuid-a"] },
        current,
        1,
      ),
    ).toBe(true);
  });
});
