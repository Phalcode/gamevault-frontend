import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMediaCache,
  getCachedMediaBlob,
  getServerNamespace,
  normalizeServerUrl,
  resetMediaCacheForTests,
  resolveApiMediaBlob,
  resolveMediaBlob,
} from "./mediaCache";

const SERVER_A = "https://games.example.test/";
const SERVER_B = "https://other.example.test";

afterEach(async () => {
  await resetMediaCacheForTests();
});

describe("media cache", () => {
  it("normalizes server URLs without credentials", () => {
    expect(
      normalizeServerUrl("https://user:secret@Games.Example.test:443/api/"),
    ).toBe("https://games.example.test/api");
    expect(getServerNamespace(SERVER_A)).toMatch(/^server-[a-f0-9]{16}$/);
    expect(getServerNamespace(SERVER_A)).not.toContain("example");
  });

  it("stores and reuses Blob responses", async () => {
    const fetchBlob = vi.fn().mockResolvedValue(new Blob(["cover"]));

    const first = await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 42,
      fetchBlob,
    });
    const second = await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 42,
      fetchBlob,
    });

    expect(await first.text()).toBe("cover");
    expect(await second.text()).toBe("cover");
    expect(fetchBlob).toHaveBeenCalledTimes(1);
  });

  it("isolates identical media IDs by server", async () => {
    const fromA = vi.fn().mockResolvedValue(new Blob(["server-a"]));
    const fromB = vi.fn().mockResolvedValue(new Blob(["server-b"]));

    await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 7,
      fetchBlob: fromA,
    });
    const result = await resolveMediaBlob({
      serverUrl: SERVER_B,
      mediaId: 7,
      fetchBlob: fromB,
    });

    expect(await result.text()).toBe("server-b");
    expect(fromA).toHaveBeenCalledTimes(1);
    expect(fromB).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent cache misses", async () => {
    let release: ((blob: Blob) => void) | undefined;
    const fetchBlob = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          release = resolve;
        }),
    );

    const first = resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 8,
      fetchBlob,
    });
    const second = resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 8,
      fetchBlob,
    });
    await vi.waitFor(() => expect(fetchBlob).toHaveBeenCalledTimes(1));
    release?.(new Blob(["shared"]));

    expect(await (await first).text()).toBe("shared");
    expect(await (await second).text()).toBe("shared");
  });

  it("replaces a game's old image when its media ID changes", async () => {
    const owner = { gameId: 99, slot: "cover" } as const;
    await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 10,
      owner,
      fetchBlob: async () => new Blob(["old"]),
    });
    await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 11,
      owner,
      fetchBlob: async () => new Blob(["new"]),
    });

    expect(await getCachedMediaBlob(SERVER_A, 10)).toBeNull();
    expect(await (await getCachedMediaBlob(SERVER_A, 11))?.text()).toBe("new");
  });

  it("keeps a replaced image while another game still references it", async () => {
    const fetchOld = async () => new Blob(["shared-old"]);
    await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 20,
      owner: { gameId: 1, slot: "cover" },
      fetchBlob: fetchOld,
    });
    await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 20,
      owner: { gameId: 2, slot: "cover" },
      fetchBlob: fetchOld,
    });
    await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 21,
      owner: { gameId: 1, slot: "cover" },
      fetchBlob: async () => new Blob(["new"]),
    });

    expect(await (await getCachedMediaBlob(SERVER_A, 20))?.text()).toBe(
      "shared-old",
    );
  });

  it("removes media unused for 30 days", async () => {
    const oldTime = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 30,
      now: oldTime,
      fetchBlob: async () => new Blob(["expired"]),
    });

    await cleanupMediaCache(Date.now(), true);

    expect(await getCachedMediaBlob(SERVER_A, 30)).toBeNull();
  });

  it("uses fallback data after a network failure", async () => {
    const result = await resolveMediaBlob({
      serverUrl: SERVER_A,
      mediaId: 40,
      fetchBlob: async () => {
        throw new Error("offline");
      },
      loadFallbackBlob: async () => new Blob(["tauri-cache"]),
    });

    expect(await result.text()).toBe("tauri-cache");
    expect(await (await getCachedMediaBlob(SERVER_A, 40))?.text()).toBe(
      "tauri-cache",
    );
  });

  it("does not consult Tauri fallback unless offline access is enabled", async () => {
    const networkError = new Error("network unavailable");

    await expect(
      resolveApiMediaBlob({
        serverUrl: SERVER_A,
        mediaId: 50,
        authFetch: async () => {
          throw networkError;
        },
      }),
    ).rejects.toBe(networkError);
  });
});
