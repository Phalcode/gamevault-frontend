import { DBSchema, IDBPDatabase, openDB } from "idb";
import { isTauriApp } from "./tauri";

const DATABASE_NAME = "gamevault-media-cache";
const DATABASE_VERSION = 1;
const UNUSED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_META_KEY = "last-cleanup";
const UNUSED_RETENTION_SECONDS = UNUSED_RETENTION_MS / 1000;

export type GameMediaSlot = "cover" | "background";

export interface GameMediaOwner {
  gameId: number;
  slot: GameMediaSlot;
}

interface MediaRecord {
  key: string;
  serverNamespace: string;
  mediaId: number;
  blob: Blob;
  contentType: string;
  byteLength: number;
  cachedAt: number;
  lastAccessedAt: number;
}

interface GameMediaBinding {
  key: string;
  serverNamespace: string;
  gameId: number;
  slot: GameMediaSlot;
  mediaKey: string;
  mediaId: number;
  lastSeenAt: number;
}

interface MetaRecord {
  key: string;
  value: number;
}

interface MediaCacheSchema extends DBSchema {
  media: {
    key: string;
    value: MediaRecord;
    indexes: {
      "by-last-accessed": number;
      "by-server": string;
    };
  };
  gameMediaBindings: {
    key: string;
    value: GameMediaBinding;
    indexes: {
      "by-last-seen": number;
      "by-media-key": string;
      "by-server": string;
    };
  };
  meta: {
    key: string;
    value: MetaRecord;
  };
}

export interface ResolveMediaBlobOptions {
  serverUrl: string;
  mediaId: number | string;
  fetchBlob: () => Promise<Blob>;
  loadFallbackBlob?: () => Promise<Blob | null>;
  owner?: GameMediaOwner;
  forceRefresh?: boolean;
  now?: number;
}

export interface ResolveApiMediaBlobOptions {
  serverUrl: string;
  mediaId: number | string;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  owner?: GameMediaOwner;
  forceRefresh?: boolean;
  allowTauriFallback?: boolean;
}

let databasePromise: Promise<IDBPDatabase<MediaCacheSchema> | null> | null =
  null;
let maintenanceStarted = false;
const inFlightRequests = new Map<string, Promise<Blob>>();
const maintainedTauriNamespaces = new Set<string>();

export function normalizeServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl.trim());
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin.toLowerCase()}${path === "/" ? "" : path}`;
}

function hashString(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, "0");
}

export function getServerNamespace(serverUrl: string): string {
  return `server-${hashString(normalizeServerUrl(serverUrl))}`;
}

function getMediaKey(serverNamespace: string, mediaId: number): string {
  return `${serverNamespace}:media:${mediaId}`;
}

function getBindingKey(serverNamespace: string, owner: GameMediaOwner): string {
  return `${serverNamespace}:game:${owner.gameId}:${owner.slot}`;
}

async function getDatabase(): Promise<IDBPDatabase<MediaCacheSchema> | null> {
  if (typeof indexedDB === "undefined") return null;

  if (!databasePromise) {
    databasePromise = openDB<MediaCacheSchema>(
      DATABASE_NAME,
      DATABASE_VERSION,
      {
        upgrade(database) {
          const mediaStore = database.createObjectStore("media", {
            keyPath: "key",
          });
          mediaStore.createIndex("by-last-accessed", "lastAccessedAt");
          mediaStore.createIndex("by-server", "serverNamespace");

          const bindingStore = database.createObjectStore("gameMediaBindings", {
            keyPath: "key",
          });
          bindingStore.createIndex("by-last-seen", "lastSeenAt");
          bindingStore.createIndex("by-media-key", "mediaKey");
          bindingStore.createIndex("by-server", "serverNamespace");

          database.createObjectStore("meta", { keyPath: "key" });
        },
      },
    ).catch(() => null);
  }

  return databasePromise;
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

async function bindGameMedia(
  database: IDBPDatabase<MediaCacheSchema>,
  serverNamespace: string,
  mediaId: number,
  owner: GameMediaOwner,
  now: number,
): Promise<void> {
  const mediaKey = getMediaKey(serverNamespace, mediaId);
  const bindingKey = getBindingKey(serverNamespace, owner);
  const transaction = database.transaction(
    ["media", "gameMediaBindings"],
    "readwrite",
  );
  const bindingStore = transaction.objectStore("gameMediaBindings");
  const previous = await bindingStore.get(bindingKey);

  await bindingStore.put({
    key: bindingKey,
    serverNamespace,
    gameId: owner.gameId,
    slot: owner.slot,
    mediaKey,
    mediaId,
    lastSeenAt: now,
  });

  if (previous && previous.mediaKey !== mediaKey) {
    const remainingReferences = await bindingStore
      .index("by-media-key")
      .count(previous.mediaKey);
    if (remainingReferences === 0) {
      await transaction.objectStore("media").delete(previous.mediaKey);
    }
  }

  await transaction.done;
}

async function readMedia(
  database: IDBPDatabase<MediaCacheSchema>,
  mediaKey: string,
  now: number,
): Promise<Blob | null> {
  const transaction = database.transaction("media", "readwrite");
  const record = await transaction.store.get(mediaKey);
  if (!record) return null;

  record.lastAccessedAt = now;
  await transaction.store.put(record);
  await transaction.done;
  return record.blob;
}

async function writeMedia(
  database: IDBPDatabase<MediaCacheSchema>,
  serverNamespace: string,
  mediaId: number,
  blob: Blob,
  now: number,
): Promise<void> {
  const record: MediaRecord = {
    key: getMediaKey(serverNamespace, mediaId),
    serverNamespace,
    mediaId,
    blob,
    contentType: blob.type,
    byteLength: blob.size,
    cachedAt: now,
    lastAccessedAt: now,
  };

  try {
    await database.put("media", record);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    await cleanupMediaCache(now, true);
    await database.put("media", record);
  }
}

export async function getCachedMediaBlob(
  serverUrl: string,
  mediaId: number | string,
  now = Date.now(),
): Promise<Blob | null> {
  const numericMediaId = Number(mediaId);
  if (!Number.isFinite(numericMediaId) || numericMediaId <= 0) return null;

  try {
    const database = await getDatabase();
    if (!database) return null;
    const namespace = getServerNamespace(serverUrl);
    return await readMedia(
      database,
      getMediaKey(namespace, numericMediaId),
      now,
    );
  } catch {
    return null;
  }
}

export async function resolveMediaBlob({
  serverUrl,
  mediaId,
  fetchBlob,
  loadFallbackBlob,
  owner,
  forceRefresh = false,
  now = Date.now(),
}: ResolveMediaBlobOptions): Promise<Blob> {
  const numericMediaId = Number(mediaId);
  if (!Number.isFinite(numericMediaId) || numericMediaId <= 0) {
    throw new Error("Invalid media ID");
  }

  const serverNamespace = getServerNamespace(serverUrl);
  const mediaKey = getMediaKey(serverNamespace, numericMediaId);
  const database = await getDatabase();

  if (database && owner) {
    try {
      await bindGameMedia(
        database,
        serverNamespace,
        numericMediaId,
        owner,
        now,
      );
    } catch {
      // Cache metadata failure must not block image loading.
    }
  }

  if (database && !forceRefresh) {
    try {
      const cached = await readMedia(database, mediaKey, now);
      if (cached) return cached;
    } catch {
      // Continue to network when IndexedDB is unavailable or corrupt.
    }
  }

  const existingRequest = inFlightRequests.get(mediaKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    let blob: Blob;
    try {
      blob = await fetchBlob();
    } catch (networkError) {
      const fallback = await loadFallbackBlob?.();
      if (!fallback) throw networkError;
      blob = fallback;
    }

    if (blob.size === 0) throw new Error("Media response was empty");

    if (database) {
      try {
        await writeMedia(database, serverNamespace, numericMediaId, blob, now);
      } catch {
        // Return fetched image when storage is full or unavailable.
      }
    }

    return blob;
  })().finally(() => {
    inFlightRequests.delete(mediaKey);
  });

  inFlightRequests.set(mediaKey, request);
  return request;
}

export async function resolveApiMediaBlob({
  serverUrl,
  mediaId,
  authFetch,
  owner,
  forceRefresh,
  allowTauriFallback = false,
}: ResolveApiMediaBlobOptions): Promise<Blob> {
  const numericMediaId = Number(mediaId);
  const base = serverUrl.replace(/\/+$/, "");
  const serverNamespace = getServerNamespace(serverUrl);

  if (isTauriApp() && !maintainedTauriNamespaces.has(serverNamespace)) {
    maintainedTauriNamespaces.add(serverNamespace);
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("cleanup_cached_images", {
          serverNamespace,
          maxAgeSeconds: UNUSED_RETENTION_SECONDS,
        }),
      )
      .catch(() => undefined);
  }

  return resolveMediaBlob({
    serverUrl,
    mediaId: numericMediaId,
    owner,
    forceRefresh,
    fetchBlob: async () => {
      const response = await authFetch(`${base}/api/media/${numericMediaId}`);
      if (!response.ok) {
        throw new Error(`Media fetch failed (${response.status})`);
      }
      return response.blob();
    },
    loadFallbackBlob: allowTauriFallback && isTauriApp()
      ? async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const cachedBytes = await invoke<number[] | null>(
              "load_cached_image",
              {
                serverNamespace,
                mediaId: numericMediaId,
              },
            );
            return cachedBytes && cachedBytes.length > 0
              ? new Blob([new Uint8Array(cachedBytes)])
              : null;
          } catch {
            return null;
          }
        }
      : undefined,
  });
}

export async function invalidateMedia(
  serverUrl: string,
  mediaId: number | string,
): Promise<void> {
  const numericMediaId = Number(mediaId);
  if (!Number.isFinite(numericMediaId) || numericMediaId <= 0) return;

  try {
    const database = await getDatabase();
    if (!database) return;
    await database.delete(
      "media",
      getMediaKey(getServerNamespace(serverUrl), numericMediaId),
    );
  } catch {
    // Invalidating a cache entry is best effort.
  }
}

export async function cleanupMediaCache(
  now = Date.now(),
  force = false,
): Promise<void> {
  const database = await getDatabase();
  if (!database) return;

  if (!force) {
    const previousCleanup = await database.get("meta", CLEANUP_META_KEY);
    if (previousCleanup && now - previousCleanup.value < CLEANUP_INTERVAL_MS) {
      return;
    }
  }

  const cutoff = now - UNUSED_RETENTION_MS;
  const transaction = database.transaction(
    ["media", "gameMediaBindings", "meta"],
    "readwrite",
  );

  let bindingCursor = await transaction
    .objectStore("gameMediaBindings")
    .index("by-last-seen")
    .openCursor(IDBKeyRange.upperBound(cutoff));
  while (bindingCursor) {
    await bindingCursor.delete();
    bindingCursor = await bindingCursor.continue();
  }

  let mediaCursor = await transaction
    .objectStore("media")
    .index("by-last-accessed")
    .openCursor(IDBKeyRange.upperBound(cutoff));
  while (mediaCursor) {
    await mediaCursor.delete();
    mediaCursor = await mediaCursor.continue();
  }

  await transaction.objectStore("meta").put({
    key: CLEANUP_META_KEY,
    value: now,
  });
  await transaction.done;
}

export async function startMediaCacheMaintenance(): Promise<void> {
  if (maintenanceStarted) return;
  maintenanceStarted = true;

  try {
    await cleanupMediaCache();
  } catch {
    // Maintenance must never block application startup.
  }
}

export async function resetMediaCacheForTests(): Promise<void> {
  const database = await databasePromise;
  database?.close();
  databasePromise = null;
  maintenanceStarted = false;
  inFlightRequests.clear();
  maintainedTauriNamespaces.clear();

  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }
}
