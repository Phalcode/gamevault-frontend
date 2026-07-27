import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import { useServerStatus } from "@/hooks/useServerStatus";
import { isTauriApp } from "@/utils/tauri";
import type { GameVaultConfig } from "@/models/gamevaultconfig";
import type { GameMetadata } from "@/api/models/GameMetadata";
import type { GamevaultGameTypeEnum } from "@/api/models/GamevaultGame";

type InstallationStatus =
  | "idle"
  | "copying"
  | "launching"
  | "running"
  | "completed"
  | "error";

export interface ActiveDownload {
  gameId: number;
  versionId: number;
  gameTitle: string;
  gameMetadata?: GameMetadata;
  gameType?: GamevaultGameTypeEnum;
  versionName?: string;
  filename: string;
  downloadDirectory?: string;
  extractionDirectory?: string;
  installationDirectory?: string;
  versionDirectory?: string;
  downloadRootPath?: string;
  downloadedFilePath?: string;
  received: number;
  total: number | null;
  progress: number | null;
  abortController: AbortController;
  startedAt: number;
  speedBps?: number;
  status: "downloading" | "paused" | "completed" | "error" | "aborted";
  error?: string;
  cachedMetadata?: Record<string, any> | null;
  extractionStatus?: "idle" | "extracting" | "completed" | "error" | "needs-password";
  extractionProgress?: number | null;
  extractionCurrentFile?: string;
  extractionError?: string;
  extractionPasswordRequired?: boolean;
  installationStatus?: InstallationStatus;
  installationProgress?: number | null;
  installationCurrentFile?: string;
  installationError?: string;
  installationExitCode?: number | null;
  fileWriter?: { close(): Promise<void>; abort(): Promise<void> };
}

interface DownloadContextValue {
  downloads: Record<number, ActiveDownload>;
  startDownload: (params: {
    gameId: number;
    versionId: number;
    versionName?: string;
    gameTitle: string;
    gameMetadata?: GameMetadata;
    gameType?: GamevaultGameTypeEnum;
    filename: string;
    downloadRootPath?: string;
  }) => void;
  cancelDownload: (gameId: number) => void;
  pauseDownload: (gameId: number) => void;
  resumeDownload: (gameId: number) => void;
  deleteDownloadCard: (gameId: number) => Promise<void>;
  retryDownload: (gameId: number) => void;
  openDownloadFolder: (gameId: number) => Promise<void>;
  extractArchive: (gameId: number, password?: string) => Promise<void>;
  listInstallExecutables: (gameId: number) => Promise<string[]>;
  copyInstallationFiles: (gameId: number) => Promise<void>;
  launchInstallationExecutable: (
    gameId: number,
    installerRelativePath: string,
  ) => Promise<void>;
  resetInstallationState: (gameId: number) => void;
  speedLimitKB: number;
  setSpeedLimitKB: (v: number) => void;
  formatBytes: (bytes: number) => string;
  formatSpeed: (bps?: number) => string;
  formatKBps: (bps?: number) => string;
  formatLimit: (kbPerSec: number) => string;
}

const DownloadContext = createContext<DownloadContextValue | null>(null);

const DEFAULT_GAME_VAULT_CONFIG: GameVaultConfig = {
  downloadfinished: false,
  extractionfinished: false,
  installationfinished: false,
  downloadprogress: "",
};

export function DownloadProvider({ children }: { children: ReactNode }) {
  const { serverUrl, authFetch, auth } = useAuth();
  const { info: serverInfo } = useServerStatus();
  const [downloads, setDownloads] = useState<Record<number, ActiveDownload>>(
    {},
  );
  const [speedLimitKB, setSpeedLimitKBState] = useState<number>(() => {
    const NEW_KEY = "download_speed_limit_kb";
    const existing = localStorage.getItem(NEW_KEY);
    if (existing) {
      const parsed = parseInt(existing, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    const downloadSpeed = localStorage.getItem("download_speed_limit");
    if (downloadSpeed) {
      const downloadSpeedBytes = parseInt(downloadSpeed, 10);
      if (!Number.isNaN(downloadSpeedBytes) && downloadSpeedBytes > 0) {
        const converted = Math.max(1, Math.round(downloadSpeedBytes / 1000)); // decimal KB
        localStorage.setItem(NEW_KEY, String(converted));
        return converted;
      }
    }
    return 0;
  });
  const speedSamplesRef = useRef<
    Record<number, { t: number; bytes: number }[]>
  >({});
  const SPEED_WINDOW_MS = 5000;
  const UI_THROTTLE_MS = 500;
  const SAMPLE_INTERVAL_MS = 250;
  const DISK_WRITE_BATCH_BYTES = 512 * 1024;
  const DEBUG_DOWNLOAD_LOGS = false;
  const dlog = (...args: any[]) => {
    if (DEBUG_DOWNLOAD_LOGS) console.log(...args);
  };
  const trimSamples = (
    samples: { t: number; bytes: number }[],
    now: number,
  ) => {
    while (samples.length && now - samples[0].t > SPEED_WINDOW_MS)
      samples.shift();
  };
  const computeSpeedBps = (
    samples: { t: number; bytes: number }[],
    received: number,
    now: number,
  ): number | undefined => {
    if (!samples.length) return undefined;
    const first = samples[0];
    const elapsedSec = (now - first.t) / 1000;
    if (elapsedSec <= 0) return undefined;
    return (received - first.bytes) / elapsedSec;
  };
  const precision = (v: number) => (v < 10 ? 2 : v < 100 ? 1 : 0);
  const trimZeros = (s: string) =>
    s.includes(".") ? s.replace(/\.?0+$/, "") : s;
  const scaleDecimal = (value: number, base: number, units: string[]) => {
    let v = value;
    let u = 0;
    while (v >= base && u < units.length - 1) {
      v /= base;
      u++;
    }
    return { value: v, unit: units[u] };
  };

  const updateDownload = useCallback(
    (gameId: number, patch: Partial<ActiveDownload>) => {
      setDownloads((prev) => {
        const existing = prev[gameId];
        if (!existing) return prev;
        return { ...prev, [gameId]: { ...existing, ...patch } };
      });
    },
    [],
  );

  const applyDefaultLaunchConfig = useCallback(
    async (d: ActiveDownload) => {
      if (!d.versionDirectory || !d.installationDirectory) return;
      const { join } = await import("@tauri-apps/api/path");
      const { invoke } = await import("@tauri-apps/api/core");

      const configPath = await join(
        d.versionDirectory,
        ".gamevault.game.config.json",
      );

      let current: Record<string, any> = {};
      if (await invoke<boolean>("fs_path_exists", { path: configPath })) {
        try {
          current = JSON.parse(await invoke<string>("fs_read_text_file", { path: configPath }));
        } catch {
          current = {};
        }
      }

      // Never overwrite a user-configured launch executable
      if (current.launchexecutable) return;

      const metaExe = (d.gameMetadata as any)?.launch_executable as
        | string
        | undefined;
      const metaParams = (d.gameMetadata as any)?.launch_parameters as
        | string
        | undefined;

      let resolvedExe: string | undefined;
      if (metaExe && metaExe.trim()) {
        // Normalize separators for comparison — list_launch_executables always returns forward slashes
        const normalized = metaExe.trim().replace(/\\/g, "/").toLowerCase();
        // Match against the actual executable list (same source as the Listbox)
        const exeList = await invoke<string[]>("list_launch_executables", {
          installationPath: d.installationDirectory,
        });
        // Case-insensitive match; use the exact casing from the list so it matches the UI
        const match = exeList.find(
          (e) => e.replace(/\\/g, "/").toLowerCase() === normalized,
        );
        if (match) resolvedExe = match;
      }

      const resolvedParams =
        metaParams && metaParams.trim() ? metaParams.trim() : undefined;

      if (!resolvedExe && !resolvedParams) return;

      if (resolvedExe !== undefined) current.launchexecutable = resolvedExe;
      if (resolvedParams !== undefined) current.launchparameters = resolvedParams;
      await invoke("fs_write_text_file", { path: configPath, content: JSON.stringify(current, null, 2) });
    },
    [],
  );

  const cacheInstalledGameData = useCallback(
    async (gameId: number) => {
      if (!isTauriApp()) return;
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const { invoke } = await import("@tauri-apps/api/core");

        // Fetch full game object
        const gameRes = await authFetch(`${base}/api/games/${gameId}`);
        if (!gameRes.ok) return;
        const gameJson = await gameRes.json();

        // Cache game data
        await invoke("cache_game_data", {
          gameId,
          json: JSON.stringify(gameJson),
        });

        // Cache cover image
        const coverId = gameJson?.metadata?.cover?.id;
        if (coverId) {
          try {
            const imgRes = await authFetch(`${base}/api/media/${coverId}`);
            if (imgRes.ok) {
              const blob = await imgRes.blob();
              const bytes = new Uint8Array(await blob.arrayBuffer());
              await invoke("cache_game_image", {
                mediaId: Number(coverId),
                bytes: Array.from(bytes),
                contentType: blob.type || "image/png",
              });
            }
          } catch { /* ignore image cache failures */ }
        }

        // Cache background image
        const bgId = gameJson?.metadata?.background?.id;
        if (bgId) {
          try {
            const imgRes = await authFetch(`${base}/api/media/${bgId}`);
            if (imgRes.ok) {
              const blob = await imgRes.blob();
              const bytes = new Uint8Array(await blob.arrayBuffer());
              await invoke("cache_game_image", {
                mediaId: Number(bgId),
                bytes: Array.from(bytes),
                contentType: blob.type || "image/png",
              });
            }
          } catch { /* ignore image cache failures */ }
        }
      } catch {
        // Silently fail — caching is best-effort, never block the user
      }
    },
    [serverUrl, authFetch],
  );

  const writeVersionConfig = useCallback(
    async (versionDirectory: string, patch: Partial<GameVaultConfig>) => {
      if (!isTauriApp() || !versionDirectory) return;
      const { join } = await import("@tauri-apps/api/path");
      const { invoke } = await import("@tauri-apps/api/core");

      const configPath = await join(
        versionDirectory,
        ".gamevault.game.config.json",
      );

      let current: GameVaultConfig = { ...DEFAULT_GAME_VAULT_CONFIG };
      if (await invoke<boolean>("fs_path_exists", { path: configPath })) {
        try {
          const raw = await invoke<string>("fs_read_text_file", { path: configPath });
          const parsed = JSON.parse(raw) as Partial<GameVaultConfig>;
          current = {
            ...DEFAULT_GAME_VAULT_CONFIG,
            ...parsed,
          };
        } catch {
          current = { ...DEFAULT_GAME_VAULT_CONFIG };
        }
      }

      const next: GameVaultConfig = {
        ...current,
        ...patch,
      };
      await invoke("fs_write_text_file", { path: configPath, content: JSON.stringify(next, null, 2) });
    },
    [],
  );

  const writeGameMetadata = useCallback(
    async (gameFolderPath: string, gameId: number) => {
      if (!isTauriApp() || !gameFolderPath) return;
      const { join } = await import("@tauri-apps/api/path");
      const { invoke } = await import("@tauri-apps/api/core");

      const serverIdentifier = serverInfo?.server_uuid || serverUrl || "unknown";

      const metadataPath = await join(gameFolderPath, ".gamevault.metadata.json");

      let current: Record<string, string> = {};
      if (await invoke<boolean>("fs_path_exists", { path: metadataPath })) {
        try {
          const raw = await invoke<string>("fs_read_text_file", { path: metadataPath });
          current = JSON.parse(raw) as Record<string, string>;
        } catch {
          current = {};
        }
      }

      current[serverIdentifier] = String(gameId);
      await invoke("fs_write_text_file", { path: metadataPath, content: JSON.stringify(current, null, 2) });
    },
    [serverInfo, serverUrl],
  );

  const cancelDownload = useCallback((gameId: number) => {
    if (isTauriApp()) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("cancel_download_task", { gameId }))
        .catch(() => {});
    }
    setDownloads((prev) => {
      const d = prev[gameId];
      if (!d) return prev;
      d.abortController.abort();
      if (d.fileWriter) {
        d.fileWriter.abort().catch(() => {});
      }
      return {
        ...prev,
        [gameId]: {
          ...d,
          status: "aborted",
          received: 0,
          total: null,
          progress: 0,
          speedBps: undefined,
        },
      };
    });
    const stop = tauriUnlistenRef.current[gameId];
    if (stop) {
      stop();
      delete tauriUnlistenRef.current[gameId];
    }
  }, []);

  const lastUpdateRef = useRef<Record<number, number>>({});
  const lastConfigWriteRef = useRef<Record<number, number>>({});
  const tauriUnlistenRef = useRef<Record<number, () => void>>({});
  const tauriExtractUnlistenRef = useRef<Record<number, () => void>>({});
  const tauriInstallCopyUnlistenRef = useRef<Record<number, () => void>>({});
  const tauriInstallerUnlistenRef = useRef<Record<number, () => void>>({});

  const startDownload = useCallback(
    async ({
      gameId,
      versionId,
      versionName,
      gameTitle,
      gameMetadata,
      gameType,
      filename,
      resumePosition,
      downloadRootPath,
    }: {
      gameId: number;
      versionId: number;
      versionName?: string;
      gameTitle: string;
      gameMetadata?: GameMetadata;
      gameType?: GamevaultGameTypeEnum;
      filename: string;
      resumePosition?: number;
      downloadRootPath?: string;
    }) => {
      if (!serverUrl) return;
      if (downloads[gameId]?.status === "downloading") return;
      const base = serverUrl.replace(/\/$/, "");
      const url = `${base}/api/game/${gameId}/versions/${versionId}`;
      const isDesktop = isTauriApp();
      let tauriFilePath: string | null = null;
      dlog("Is Tauri Desktop App:", isDesktop);
      const ac = new AbortController();
      const entry: ActiveDownload = {
        gameId,
        versionId,
        gameTitle,
        gameMetadata,
        gameType,
        versionName,
        filename,
        downloadRootPath,
        received: resumePosition && resumePosition > 0 ? resumePosition : 0,
        total: null,
        progress: 0,
        abortController: ac,
        startedAt: performance.now(),
        status: "downloading",
        extractionStatus: "idle",
        installationStatus: "idle",
      };
      setDownloads((prev) => ({ ...prev, [gameId]: entry }));
      speedSamplesRef.current[gameId] = [
        {
          t: performance.now(),
          bytes: resumePosition && resumePosition > 0 ? resumePosition : 0,
        },
      ];

      try {
        // Handle Tauri-specific downloads
        if (isDesktop) {
          dlog("=== Starting Tauri Download ===");
          const downloadPath =
            downloadRootPath ||
            (() => {
              try {
                return localStorage.getItem("tauri_download_path");
              } catch {
                return null;
              }
            })();
          dlog("Tauri download path:", downloadPath);
          if (!downloadPath) {
            updateDownload(gameId, {
              status: "error",
              error:
                "No download location configured. Please set one in Settings.",
            });
            return;
          }

          dlog("Importing Tauri modules...");
          const { join } = await import("@tauri-apps/api/path");
          const { invoke } = await import("@tauri-apps/api/core");
          const { listen } = await import("@tauri-apps/api/event");

          const sanitizeFolderName = (value: string) =>
            (value || "")
              .replace(/[\\/:*?"<>|]/g, "_")
              .replace(/\s+/g, " ")
              .trim();

          const gameFolderName =
            sanitizeFolderName(gameTitle) || `Game-${gameId}`;
          const versionFolderName = `(${versionId}) ${versionName ?? ""}`.trimEnd();

          const gameVaultRoot = await join(downloadPath, "GameVault");
          const gameFolderPath = await join(gameVaultRoot, gameFolderName);
          const versionBaseFolder = await join(
            gameFolderPath,
            "Versions",
            versionFolderName,
          );
          const downloadsVersionFolder = await join(
            versionBaseFolder,
            "Download",
          );
          const extractionsVersionFolder = await join(
            versionBaseFolder,
            "Extraction",
          );
          const installationsVersionFolder = await join(
            versionBaseFolder,
            "Installation",
          );

          await invoke("fs_create_dir_all", { path: downloadsVersionFolder });
          await invoke("fs_create_dir_all", { path: extractionsVersionFolder });
          await invoke("fs_create_dir_all", { path: installationsVersionFolder });
          await writeGameMetadata(gameFolderPath, gameId);
          await writeVersionConfig(versionBaseFolder, {
            versionid: versionId,
            gametype: gameType,
            downloadfinished: false,
            extractionfinished: false,
            installationfinished: false,
            downloadprogress:
              resumePosition && resumePosition > 0
                ? `${resumePosition}/0`
                : "0/0",
          });

          dlog("Joining paths:", { downloadsVersionFolder, filename });
          const filePath = await join(downloadsVersionFolder, filename);
          tauriFilePath = filePath;
          updateDownload(gameId, {
            downloadDirectory: downloadsVersionFolder,
            extractionDirectory: extractionsVersionFolder,
            installationDirectory: installationsVersionFolder,
            versionDirectory: versionBaseFolder,
            downloadedFilePath: filePath,
            downloadRootPath: downloadPath,
          });
          dlog("Full file path:", filePath);
          dlog("File path type:", typeof filePath);
          dlog("File path length:", filePath.length);
          if (tauriUnlistenRef.current[gameId]) {
            tauriUnlistenRef.current[gameId]();
            delete tauriUnlistenRef.current[gameId];
          }

          const unlisten = await listen<any>("download-progress", (event) => {
            const payload = event.payload;
            if (!payload || payload.gameId !== gameId) return;

            if (payload.status === "downloading") {
              const received = Number(payload.received || 0);
              const total =
                payload.total !== undefined && payload.total !== null
                  ? Number(payload.total)
                  : 0;
              const progress = total > 0 ? (received / total) * 100 : 0;
              const now = performance.now();
              const samples = speedSamplesRef.current[gameId];
              samples.push({ t: now, bytes: received });
              trimSamples(samples, now);
              const speedBps = computeSpeedBps(samples, received, now);
              updateDownload(gameId, {
                filename:
                  typeof payload.filename === "string" && payload.filename
                    ? payload.filename
                    : entry.filename,
                downloadedFilePath:
                  typeof payload.filePath === "string" && payload.filePath
                    ? payload.filePath
                    : undefined,
                received,
                total: total || null,
                progress,
                speedBps,
              });
              const lastConfigWrite = lastConfigWriteRef.current[gameId] || 0;
              if (now - lastConfigWrite >= 1000) {
                lastConfigWriteRef.current[gameId] = now;
                void writeVersionConfig(versionBaseFolder, {
                  downloadfinished: false,
                  downloadprogress: `${received}/${total || 0}`,
                });
              }
              return;
            }

            if (payload.status === "paused") {
              const received = Number(payload.received || 0);
              const total =
                payload.total !== undefined && payload.total !== null
                  ? Number(payload.total)
                  : 0;
              const progress = total > 0 ? (received / total) * 100 : 0;
              void writeVersionConfig(versionBaseFolder, {
                downloadfinished: false,
                downloadprogress: `${received}/${total || 0}`,
              });
              updateDownload(gameId, {
                status: "paused",
                received,
                total: total || null,
                progress,
                speedBps: undefined,
                filename:
                  typeof payload.filename === "string" && payload.filename
                    ? payload.filename
                    : entry.filename,
                downloadedFilePath:
                  typeof payload.filePath === "string" && payload.filePath
                    ? payload.filePath
                    : undefined,
              });
              const stop = tauriUnlistenRef.current[gameId];
              if (stop) {
                stop();
                delete tauriUnlistenRef.current[gameId];
              }
              return;
            }

            if (payload.status === "completed") {
              const received = Number(payload.received || 0);
              const total =
                payload.total !== undefined && payload.total !== null
                  ? Number(payload.total)
                  : null;
              void writeVersionConfig(versionBaseFolder, {
                downloadfinished: true,
                downloadprogress: `${
                  total && total > 0 ? total : received
                }/${total && total > 0 ? total : received}`,
              });
              updateDownload(gameId, {
                status: "completed",
                progress: 100,
                received: total && total > 0 ? total : received,
                total,
                speedBps: undefined,
                filename:
                  typeof payload.filename === "string" && payload.filename
                    ? payload.filename
                    : entry.filename,
                downloadedFilePath:
                  typeof payload.filePath === "string" && payload.filePath
                    ? payload.filePath
                    : undefined,
              });
              // Cache game data + images for offline use (Download tab)
              cacheInstalledGameData(gameId);
            } else if (payload.status === "aborted") {
              void writeVersionConfig(versionBaseFolder, {
                downloadfinished: false,
                downloadprogress: "",
              });
              updateDownload(gameId, {
                status: "aborted",
                received: 0,
                total: null,
                progress: 0,
                speedBps: undefined,
              });
            } else if (payload.status === "error") {
              void writeVersionConfig(versionBaseFolder, {
                downloadfinished: false,
              });
              updateDownload(gameId, {
                status: "error",
                error: payload.error || "Download failed",
                received: 0,
                total: null,
                progress: 0,
                speedBps: undefined,
              });
            }

            const stop = tauriUnlistenRef.current[gameId];
            if (stop) {
              stop();
              delete tauriUnlistenRef.current[gameId];
            }
          });

          tauriUnlistenRef.current[gameId] = unlisten;

          const authHeader = auth?.access_token
            ? `Bearer ${auth.access_token}`
            : null;

          await invoke("download_game_version", {
            gameId,
            url,
            destinationDir: downloadsVersionFolder,
            fallbackFilename: filename,
            authHeader,
            resumePosition:
              resumePosition && resumePosition > 0 ? resumePosition : null,
          });
          return;
        }

        // Handle non-Tauri downloads (web browser)
        if (!isDesktop) {
          try {
            const downloadSpeed = localStorage.getItem(
              "download_speed_limit_kb",
            );
            const downloadSpeedBytes = parseInt(downloadSpeed || "0", 10);
            const response = await authFetch(url, {
              method: "GET",
              signal: ac.signal,
              headers: { "X-Download-Speed-Limit": String(downloadSpeedBytes) },
            });
            const otp = response.headers.get("X-Otp");
            if (response.ok && otp) {
              const a = document.createElement("a");
              a.href = `${base}/api/otp/game?otp=${otp}`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              updateDownload(gameId, {
                status: "completed",
                progress: 100,
                received: 0,
                total: null,
              });
              return;
            }
          } catch (_) {}
        }
        let writer: {
          write(data: any): Promise<void>;
          close(): Promise<void>;
          abort(): Promise<void>;
        } | null = null;
        if (
          isDesktop &&
          typeof (window as any).showSaveFilePicker === "function"
        ) {
          try {
            const handle = await (window as any).showSaveFilePicker({
              suggestedName: filename,
            });
            writer = await handle.createWritable();
            if (writer) updateDownload(gameId, { fileWriter: writer });
          } catch (pickErr: any) {
            if (pickErr?.name === "AbortError") {
              updateDownload(gameId, { status: "aborted" });
              return;
            }
            throw pickErr;
          }
        }
        const res = await authFetch(url, {
          method: "GET",
          headers: {
            "X-Download-Speed-Limit": String(speedLimitKB),
            ...(resumePosition && resumePosition > 0
              ? { Range: `bytes=${resumePosition}-` }
              : {}),
          },
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentLength = Number(res.headers.get("Content-Length")) || 0;
        const total =
          resumePosition && resumePosition > 0
            ? contentLength + resumePosition
            : contentLength;
        if (total > 0) updateDownload(gameId, { total });
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Streaming not supported");
        const chunks: (Uint8Array | ArrayBuffer)[] = writer ? [] : [];
        let received = resumePosition && resumePosition > 0 ? resumePosition : 0;
        let lastSamplePush = performance.now();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            if (writer) await writer.write(value);
            else chunks.push(value);
            received += value.length;
            const progressDecimal = total > 0 ? received / total : 0;
            const progress = progressDecimal * 100; // Convert to percentage
            const now = performance.now();
            const samples = speedSamplesRef.current[gameId];
            if (now - lastSamplePush >= SAMPLE_INTERVAL_MS || progressDecimal === 1) {
              samples.push({ t: now, bytes: received });
              trimSamples(samples, now);
              lastSamplePush = now;
            }
            const speedBps = computeSpeedBps(samples, received, now);
            const last = lastUpdateRef.current[gameId] || 0;
            if (now - last > UI_THROTTLE_MS || progressDecimal === 1) {
              lastUpdateRef.current[gameId] = now;
              updateDownload(gameId, { received, progress, speedBps });
            }
          }
        }
        if (writer) await writer.close();
        else {
          const blob = new Blob(chunks as BlobPart[]);
          const objectUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(objectUrl);
        }
        updateDownload(gameId, {
          status: "completed",
          progress: 100,
          received: total > 0 ? total : received,
          total: total || null,
          speedBps: undefined,
        });
      } catch (err: any) {
        if (isDesktop && tauriFilePath) {
          try {
            const { invoke: invokeCleanup } = await import("@tauri-apps/api/core");
            if (await invokeCleanup<boolean>("fs_path_exists", { path: tauriFilePath })) {
              await invokeCleanup("fs_remove", { path: tauriFilePath, recursive: false });
            }
          } catch (cleanupError) {
            console.warn("Could not remove partial download:", cleanupError);
          }
        }
        if (err?.name === "AbortError") {
          setDownloads((prev) => {
            const existing = prev[gameId];
            if (!existing) return prev;
            if (existing.status === "aborted") return prev;
            return {
              ...prev,
              [gameId]: {
                ...existing,
                status: "paused",
                speedBps: undefined,
              },
            };
          });
        } else {
          updateDownload(gameId, {
            status: "error",
            error: String(err),
            received: 0,
            total: null,
            progress: 0,
            speedBps: undefined,
          });
        }
      }
    },
    [
      serverUrl,
      authFetch,
      auth,
      downloads,
      updateDownload,
      writeGameMetadata,
      writeVersionConfig,
      speedLimitKB,
      trimSamples,
      computeSpeedBps,
    ],
  );

  const pauseDownload = useCallback((gameId: number) => {
    const d = downloads[gameId];
    if (!d || d.status !== "downloading") return;
    if (isTauriApp()) {
      import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("pause_download_task", { gameId }))
        .catch(() => {});
      return;
    }
    d.abortController.abort();6
    updateDownload(gameId, {
      status: "paused",
      speedBps: undefined,
    });
  }, [downloads, updateDownload]);

  const resumeDownload = useCallback(
    (gameId: number) => {
      const d = downloads[gameId];
      if (!d || (d.status !== "paused" && d.status !== "aborted")) return;
      void startDownload({
        gameId: d.gameId,
        versionId: d.versionId,
        versionName: d.versionName,
        gameTitle: d.gameTitle,
        gameMetadata: d.gameMetadata,
        gameType: d.gameType,
        filename: d.filename,
        resumePosition: d.received > 0 ? d.received : 0,
      });
    },
    [downloads, startDownload],
  );

  const deleteDownloadCard = useCallback(
    async (gameId: number) => {
      const d = downloads[gameId];
      if (!d) return;

      if (d.versionDirectory) {
        try {
          await writeVersionConfig(d.versionDirectory, {
            downloadfinished: false,
            extractionfinished: false,
            downloadprogress: "",
          });
        } catch (error) {
          console.warn("Failed to reset game config flags before deletion:", error);
        }
      }

      if (d.status === "downloading") {
        if (isTauriApp()) {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("cancel_download_task", { gameId });
          } catch {
            // best effort
          }
        }
        d.abortController.abort();
        if (d.fileWriter) {
          try {
            await d.fileWriter.abort();
          } catch {
            // best effort
          }
        }
      }

      const stopDownloadListener = tauriUnlistenRef.current[gameId];
      if (stopDownloadListener) {
        stopDownloadListener();
        delete tauriUnlistenRef.current[gameId];
      }
      const stopExtractListener = tauriExtractUnlistenRef.current[gameId];
      if (stopExtractListener) {
        stopExtractListener();
        delete tauriExtractUnlistenRef.current[gameId];
      }
      const stopInstallCopyListener = tauriInstallCopyUnlistenRef.current[gameId];
      if (stopInstallCopyListener) {
        stopInstallCopyListener();
        delete tauriInstallCopyUnlistenRef.current[gameId];
      }
      const stopInstallerListener = tauriInstallerUnlistenRef.current[gameId];
      if (stopInstallerListener) {
        stopInstallerListener();
        delete tauriInstallerUnlistenRef.current[gameId];
      }

      delete speedSamplesRef.current[gameId];
      delete lastUpdateRef.current[gameId];
      delete lastConfigWriteRef.current[gameId];

      if (isTauriApp()) {
        try {
          const { invoke: invokeFsCleanup } = await import("@tauri-apps/api/core");
          if (d.downloadDirectory && (await invokeFsCleanup<boolean>("fs_path_exists", { path: d.downloadDirectory }))) {
            await invokeFsCleanup("fs_remove", { path: d.downloadDirectory, recursive: true });
          }
          if (d.extractionDirectory && (await invokeFsCleanup<boolean>("fs_path_exists", { path: d.extractionDirectory }))) {
            await invokeFsCleanup("fs_remove", { path: d.extractionDirectory, recursive: true });
          }
        } catch (error) {
          console.warn("Failed to delete download/extraction folders:", error);
        }
      }

      setDownloads((prev) => {
        if (!prev[gameId]) return prev;
        const next = { ...prev };
        delete next[gameId];
        return next;
      });
    },
    [downloads, writeVersionConfig],
  );

  const retryDownload = useCallback(
    (gameId: number) => {
      const d = downloads[gameId];
      if (!d) return;
      void startDownload({
        gameId: d.gameId,
        versionId: d.versionId,
        versionName: d.versionName,
        gameTitle: d.gameTitle,
        gameMetadata: d.gameMetadata,
        gameType: d.gameType,
        filename: d.filename,
        downloadRootPath: d.downloadRootPath,
      });
    },
    [downloads, startDownload],
  );

  const openDownloadFolder = useCallback(
    async (gameId: number) => {
      if (!isTauriApp()) return;
      const d = downloads[gameId];
      if (!d?.versionDirectory) return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_in_file_explorer", { path: d.versionDirectory });
    },
    [downloads],
  );

  const extractArchive = useCallback(
    async (gameId: number, password?: string) => {
      if (!isTauriApp()) return;
      const d = downloads[gameId];
      if (!d?.downloadedFilePath || !d.extractionDirectory) return;

      updateDownload(gameId, {
        extractionStatus: "extracting",
        extractionProgress: 0,
        extractionCurrentFile: undefined,
        extractionError: undefined,
        extractionPasswordRequired: false,
      });

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        if (tauriExtractUnlistenRef.current[gameId]) {
          tauriExtractUnlistenRef.current[gameId]();
          delete tauriExtractUnlistenRef.current[gameId];
        }

        const unlisten = await listen<any>("extract-progress", (event) => {
          const payload = event.payload;
          if (!payload || payload.gameId !== gameId) return;

          if (payload.status === "extracting") {
            updateDownload(gameId, {
              extractionStatus: "extracting",
              extractionProgress:
                typeof payload.progress === "number"
                  ? Math.max(0, Math.min(100, payload.progress))
                  : null,
              extractionCurrentFile:
                typeof payload.currentFile === "string" && payload.currentFile
                  ? payload.currentFile
                  : undefined,
            });
            return;
          }

          if (payload.status === "completed") {
            updateDownload(gameId, {
              extractionStatus: "completed",
              extractionProgress: 100,
              extractionCurrentFile: undefined,
            });
          } else if (payload.status === "needs-password") {
            updateDownload(gameId, {
              extractionStatus: "needs-password",
              extractionPasswordRequired: true,
              extractionError:
                (typeof payload.error === "string" && payload.error) ||
                "Archive password required.",
            });
          } else if (payload.status === "error") {
            updateDownload(gameId, {
              extractionStatus: "error",
              extractionError:
                (typeof payload.error === "string" && payload.error) ||
                "Extraction failed.",
            });
          }
        });

        tauriExtractUnlistenRef.current[gameId] = unlisten;

        const result = await invoke<{
          success: boolean;
          needsPassword: boolean;
          message?: string;
        }>("extract_archive", {
          gameId,
          archivePath: d.downloadedFilePath,
          destinationPath: d.extractionDirectory,
          password: password?.trim() || null,
        });

        if (result.success) {
          if (d.versionDirectory) {
            await writeVersionConfig(d.versionDirectory, {
              extractionfinished: true,
            });
          }
          updateDownload(gameId, {
            extractionStatus: "completed",
            extractionProgress: 100,
            extractionCurrentFile: undefined,
            extractionError: undefined,
            extractionPasswordRequired: false,
          });
          return;
        }

        if (result.needsPassword) {
          updateDownload(gameId, {
            extractionStatus: "needs-password",
            extractionProgress: null,
            extractionPasswordRequired: true,
            extractionError: result.message || "Archive password required.",
          });
          return;
        }

        updateDownload(gameId, {
          extractionStatus: "error",
          extractionProgress: null,
          extractionError: result.message || "Extraction failed.",
        });
      } catch (err) {
        updateDownload(gameId, {
          extractionStatus: "error",
          extractionProgress: null,
          extractionError: String(err),
        });
      } finally {
        const stop = tauriExtractUnlistenRef.current[gameId];
        if (stop) {
          stop();
          delete tauriExtractUnlistenRef.current[gameId];
        }
      }
    },
    [downloads, updateDownload, writeVersionConfig],
  );

  const resetInstallationState = useCallback(
    (gameId: number) => {
      updateDownload(gameId, {
        installationStatus: "idle",
        installationProgress: null,
        installationCurrentFile: undefined,
        installationError: undefined,
        installationExitCode: null,
      });
    },
    [updateDownload],
  );

  const listInstallExecutables = useCallback(
    async (gameId: number) => {
      if (!isTauriApp()) return [];
      const d = downloads[gameId];
      if (!d?.extractionDirectory) return [];
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<string[]>("list_install_executables", {
        extractionPath: d.extractionDirectory,
      });
    },
    [downloads],
  );

  const copyInstallationFiles = useCallback(
    async (gameId: number) => {
      if (!isTauriApp()) return;
      const d = downloads[gameId];
      if (!d?.extractionDirectory || !d.installationDirectory) return;

      if (d.versionDirectory) {
        await writeVersionConfig(d.versionDirectory, {
          installationfinished: false,
        });
      }

      updateDownload(gameId, {
        installationStatus: "copying",
        installationProgress: 0,
        installationCurrentFile: undefined,
        installationError: undefined,
        installationExitCode: null,
      });

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        if (tauriInstallCopyUnlistenRef.current[gameId]) {
          tauriInstallCopyUnlistenRef.current[gameId]();
          delete tauriInstallCopyUnlistenRef.current[gameId];
        }

        const unlisten = await listen<any>("install-copy-progress", async (event) => {
          const payload = event.payload;
          if (!payload || payload.gameId !== gameId) return;

          if (payload.status === "copying") {
            updateDownload(gameId, {
              installationStatus: "copying",
              installationProgress:
                typeof payload.progress === "number"
                  ? Math.max(0, Math.min(100, payload.progress))
                  : null,
              installationCurrentFile:
                typeof payload.currentFile === "string" && payload.currentFile
                  ? payload.currentFile
                  : undefined,
              installationError: undefined,
            });
            return;
          }

          if (payload.status === "completed") {
            if (d.versionDirectory) {
              await writeVersionConfig(d.versionDirectory, {
                installationfinished: true,
              });
              await applyDefaultLaunchConfig(d);
            }
            updateDownload(gameId, {
              installationStatus: "completed",
              installationProgress: 100,
              installationCurrentFile: undefined,
              installationError: undefined,
            });
            // Cache game data for offline use
            cacheInstalledGameData(gameId);
          } else if (payload.status === "error") {
            updateDownload(gameId, {
              installationStatus: "error",
              installationProgress: null,
              installationError:
                (typeof payload.error === "string" && payload.error) ||
                "Installation copy failed.",
            });
          }

          const stop = tauriInstallCopyUnlistenRef.current[gameId];
          if (stop) {
            stop();
            delete tauriInstallCopyUnlistenRef.current[gameId];
          }
        });

        tauriInstallCopyUnlistenRef.current[gameId] = unlisten;

        await invoke("copy_installation_files", {
          gameId,
          sourcePath: d.extractionDirectory,
          destinationPath: d.installationDirectory,
        });
      } catch (err) {
        const stop = tauriInstallCopyUnlistenRef.current[gameId];
        if (stop) {
          stop();
          delete tauriInstallCopyUnlistenRef.current[gameId];
        }
        updateDownload(gameId, {
          installationStatus: "error",
          installationProgress: null,
          installationError: String(err),
        });
      }
    },
    [downloads, updateDownload],
  );

  const launchInstallationExecutable = useCallback(
    async (gameId: number, installerRelativePath: string) => {
      if (!isTauriApp()) return;
      const d = downloads[gameId];
      if (!d?.extractionDirectory || !d.installationDirectory) return;

      if (d.versionDirectory) {
        await writeVersionConfig(d.versionDirectory, {
          installationfinished: false,
        });
      }

      updateDownload(gameId, {
        installationStatus: "launching",
        installationProgress: null,
        installationCurrentFile: installerRelativePath,
        installationError: undefined,
        installationExitCode: null,
      });

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        if (tauriInstallerUnlistenRef.current[gameId]) {
          tauriInstallerUnlistenRef.current[gameId]();
          delete tauriInstallerUnlistenRef.current[gameId];
        }

        const unlisten = await listen<any>("installer-status", async (event) => {
          const payload = event.payload;
          if (!payload || payload.gameId !== gameId) return;

          if (payload.status === "launching") {
            updateDownload(gameId, {
              installationStatus: "launching",
              installationCurrentFile:
                typeof payload.currentFile === "string" && payload.currentFile
                  ? payload.currentFile
                  : installerRelativePath,
              installationError: undefined,
            });
            return;
          }

          if (payload.status === "running") {
            updateDownload(gameId, {
              installationStatus: "running",
              installationCurrentFile:
                typeof payload.currentFile === "string" && payload.currentFile
                  ? payload.currentFile
                  : installerRelativePath,
              installationError: undefined,
            });
            return;
          }

          if (payload.status === "completed") {
            if (d.versionDirectory) {
              await writeVersionConfig(d.versionDirectory, {
                installationfinished: true,
              });
              await applyDefaultLaunchConfig(d);
            }
            updateDownload(gameId, {
              installationStatus: "completed",
              installationCurrentFile: undefined,
              installationError: undefined,
              installationExitCode:
                typeof payload.exitCode === "number" ? payload.exitCode : 0,
            });
            // Cache game data for offline use
            cacheInstalledGameData(gameId);
          } else if (payload.status === "error") {
            updateDownload(gameId, {
              installationStatus: "error",
              installationError:
                (typeof payload.error === "string" && payload.error) ||
                "Installer exited with an error.",
              installationExitCode:
                typeof payload.exitCode === "number"
                  ? payload.exitCode
                  : null,
            });
          }

          const stop = tauriInstallerUnlistenRef.current[gameId];
          if (stop) {
            stop();
            delete tauriInstallerUnlistenRef.current[gameId];
          }
        });

        tauriInstallerUnlistenRef.current[gameId] = unlisten;

        await invoke("launch_installation_executable", {
          gameId,
          extractionPath: d.extractionDirectory,
          installerRelativePath,
          installationPath: d.installationDirectory,
        });
      } catch (err) {
        const stop = tauriInstallerUnlistenRef.current[gameId];
        if (stop) {
          stop();
          delete tauriInstallerUnlistenRef.current[gameId];
        }
        updateDownload(gameId, {
          installationStatus: "error",
          installationError: String(err),
          installationExitCode: null,
        });
      }
    },
    [downloads, updateDownload],
  );

  const setSpeedLimitKB = useCallback((v: number) => {
    const val = Math.max(0, v || 0);
    setSpeedLimitKBState(val);
    localStorage.setItem("download_speed_limit_kb", String(val));
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "download_speed_limit_kb" && e.newValue !== null) {
        const parsed = parseInt(e.newValue, 10);
        if (!Number.isNaN(parsed)) setSpeedLimitKBState(parsed);
      } else if (e.key === "download_speed_limit" && e.newValue !== null) {
        const legacyBytes = parseInt(e.newValue, 10);
        if (!Number.isNaN(legacyBytes)) {
          const converted = Math.max(
            legacyBytes > 0 ? 1 : 0,
            Math.round(legacyBytes / 1000),
          );
          setSpeedLimitKBState(converted);
          localStorage.setItem("download_speed_limit_kb", String(converted));
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    let mounted = true;

    const recoverDownloads = async () => {
      if (!isTauriApp()) return;

      try {
        const { getRootPaths } = await import("@/utils/rootPaths");
        const rootPaths = getRootPaths();
        if (!rootPaths.length) return;

        const { invoke } = await import("@tauri-apps/api/core");
        const recovered: Record<number, ActiveDownload> = {};

        for (const root of rootPaths) {
          const recoveredCards = await invoke<any[]>("recover_download_cards", {
            selectedRoot: root.path,
          }).catch(() => [] as any[]);

          for (const card of recoveredCards || []) {
            const gameId = Number(card.gameId || 0);
            if (!gameId || recovered[gameId]) continue;

            recovered[gameId] = {
              gameId,
              versionId: Number(card.versionId || 0),
              gameTitle: String(card.gameTitle || "Unknown Game"),
              gameMetadata: card.gameMetadata,
              gameType: card.gameType
                ? (String(card.gameType) as GamevaultGameTypeEnum)
                : undefined,
              versionName: String(card.versionName || ""),
              filename: String(card.filename || "download.bin"),
              downloadDirectory: String(card.downloadDirectory || ""),
              extractionDirectory: String(card.extractionDirectory || ""),
              installationDirectory: String(card.installationDirectory || ""),
              versionDirectory: String(card.versionDirectory || ""),
              downloadedFilePath: card.downloadedFilePath
                ? String(card.downloadedFilePath)
                : undefined,
              downloadRootPath: root.path,
              received: Number(card.received || 0),
              total:
                card.total !== undefined && card.total !== null
                  ? Number(card.total)
                  : null,
              progress: Number(card.progress || 0),
              abortController: new AbortController(),
              startedAt: performance.now(),
              speedBps: undefined,
              status:
                card.status === "completed"
                  ? "completed"
                  : card.status === "paused"
                    ? "paused"
                  : card.status === "error"
                    ? "error"
                    : "aborted",
              extractionStatus:
                card.extractionStatus === "completed"
                  ? "completed"
                  : "idle",
              extractionProgress:
                card.extractionProgress !== undefined &&
                card.extractionProgress !== null
                  ? Number(card.extractionProgress)
                  : null,
              installationStatus: card.installationFinished
                ? "completed"
                : "idle",
              installationProgress: card.installationFinished ? 100 : null,
              installationCurrentFile: undefined,
              installationError: undefined,
              installationExitCode: card.installationFinished ? 0 : null,
              cachedMetadata: card.cachedMetadata ?? null,
            };
          }
        }

        if (!mounted || !Object.keys(recovered).length) return;
        setDownloads((prev) => ({ ...recovered, ...prev }));

        // Load cached game data so recovered cards have full metadata (cover, etc.)
        for (const [idStr, dl] of Object.entries(recovered)) {
          try {
            const cached = await invoke<string | null>("load_cached_game", { gameId: Number(idStr) });
            if (cached && mounted) {
              const parsed = JSON.parse(cached);
              // cache stores the full GamevaultGame; extract just the metadata for GameMetadata shape
              const meta = parsed?.metadata || parsed;
              setDownloads((prev) => {
                const existing = prev[Number(idStr)];
                if (!existing) return prev;
                return { ...prev, [Number(idStr)]: { ...existing, gameMetadata: meta } };
              });
            }
          } catch { /* best-effort */ }
        }
      } catch (error) {
        console.warn("Failed to recover downloads from GameVault config:", error);
      }
    };

    void recoverDownloads();
    return () => {
      mounted = false;
    };
  }, []);

  // Cleanup orphaned offline caches on startup
  useEffect(() => {
    if (!isTauriApp()) return;

    const cleanupOrphanCaches = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { getRootPaths } = await import("@/utils/rootPaths");
        const cachedIds = await invoke<number[]>("list_cached_game_ids");
        if (!cachedIds.length) return;

        // Get installed game IDs from all roots
        const rootPaths = getRootPaths();
        const knownIds = new Set<number>();
        for (const root of rootPaths) {
          const installed = await invoke<any[]>("list_installed_games", { selectedRoot: root.path }).catch(() => [] as any[]);
          for (const g of installed) {
            const id = g.gameId ?? g.game_id ?? 0;
            if (id > 0) knownIds.add(id);
          }

          // Active downloads
          const recovered = await invoke<any[]>("recover_download_cards", {
            selectedRoot: root.path,
          }).catch(() => [] as any[]);
          for (const c of recovered) {
            const id = Number(c.gameId || 0);
            if (id > 0) knownIds.add(id);
          }
        }

        // Delete caches for games that are neither installed nor actively downloading
        for (const id of cachedIds) {
          if (!knownIds.has(id)) {
            await invoke("delete_cached_game", { gameId: id }).catch(() => {});
          }
        }
      } catch { /* best-effort */ }
    };

    cleanupOrphanCaches();
  }, []);

  const formatBytes = useCallback((bytes: number) => {
    if (!isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let v = bytes / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u++;
    }
    return `${trimZeros(v.toFixed(precision(v)))} ${units[u]}`;
  }, []);

  const formatSpeed = useCallback((bps?: number) => {
    if (bps === undefined || bps === null || !isFinite(bps)) return "";
    if (bps < 1000) return `${bps.toFixed(0)} B/s`;
    // decimal scaling
    let { value: v, unit } = scaleDecimal(bps / 1000, 1000, [
      "KB",
      "MB",
      "GB",
      "TB",
      "PB",
    ]);
    return `${trimZeros(v.toFixed(precision(v)))} ${unit}/s`;
  }, []);

  const formatKBps = useCallback((bps?: number) => {
    if (bps === undefined || bps === null || !isFinite(bps) || bps <= 0)
      return "0 KB/s";
    const kb = bps / 1000;
    return `${trimZeros(kb.toFixed(precision(kb)))} KB/s`;
  }, []);

  const formatLimit = useCallback((kbPerSec: number) => {
    if (!kbPerSec || kbPerSec <= 0) return "Unlimited";
    let { value: v, unit } = scaleDecimal(kbPerSec, 1000, [
      "KB/s",
      "MB/s",
      "GB/s",
      "TB/s",
    ]);
    return `${trimZeros(v.toFixed(precision(v)))} ${unit}`;
  }, []);

  const value: DownloadContextValue = {
    downloads,
    startDownload,
    cancelDownload,
    pauseDownload,
    resumeDownload,
    deleteDownloadCard,
    retryDownload,
    openDownloadFolder,
    extractArchive,
    listInstallExecutables,
    copyInstallationFiles,
    launchInstallationExecutable,
    resetInstallationState,
    speedLimitKB,
    setSpeedLimitKB,
    formatBytes,
    formatSpeed,
    formatKBps,
    formatLimit,
  };
  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownloads() {
  const ctx = useContext(DownloadContext);
  if (!ctx)
    throw new Error("useDownloads must be used within DownloadProvider");
  return ctx;
}
