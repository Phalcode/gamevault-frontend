import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { useAlertDialog } from "@/context/AlertDialogContext";
import {
  useInstalledGames,
  type InstalledGameInfo,
} from "@/hooks/useInstalledGames";
import { isTauriApp } from "@/utils/tauri";
import {
  launchInstalledGame,
  launchOutcomeAlert,
} from "@/utils/launchInstalledGame";
import {
  installedGameTitle,
  trayRecentGames,
  type TrayRecentGame,
} from "@/utils/trayRecentGames";

/**
 * Serves the native menus that sit outside the webview: the system tray menu
 * and the Windows taskbar jump list.
 *
 * Both live in Rust (`src-tauri/src/tray.rs` and `jumplist.rs`) and know
 * nothing about the server, so this hook is what makes them useful:
 *
 * - it feeds them the most recently used installed games (played *or*
 *   installed), which is the shortcut both menus offer, and
 * - it performs the actions they cannot: launching a game and switching pages.
 *
 * Actions arrive through a queue rather than a direct event, because a jump
 * list entry starts a *second* process whose request has to survive the trip
 * into the running app — and because a jump list click can arrive before the
 * window has finished loading.
 *
 * The "now playing" line and the play badge on the tray icon are *not* driven
 * from here: the native time tracker owns those, as only it knows when a game
 * actually runs and for how long.
 */

/** How many installed games the tray menu offers. Mirrors the Rust side. */
const RECENT_GAME_LIMIT = 5;

/** Rust tells us the queue is non-empty on this event. */
const ACTIONS_PENDING_EVENT = "tray-actions-pending";

/** Pages the tray menu and jump list can jump to. Mirrors `tray::PAGES`. */
const TRAY_ROUTES = new Set(["library", "downloads", "community", "settings"]);

/** Mirrors `tray::TrayAction`. */
type TrayActionPayload =
  { kind: "navigate"; value: string } | { kind: "launchGame"; value: number };

/**
 * How long to wait for the installed-games scan before giving up on a launch
 * request. A jump list entry can arrive while the very first scan is still
 * running, and reporting "not installed" then would be wrong.
 */
const INSTALLED_GAMES_WAIT_MS = 10_000;
const INSTALLED_GAMES_POLL_MS = 250;

export function useTrayMenu() {
  const navigate = useNavigate();
  const { showAlert } = useAlertDialog();
  const { installedGames, loading } = useInstalledGames();

  // The action listener is registered once, so it reads the current library
  // from refs instead of re-subscribing on every refresh.
  const installedGamesRef = useRef<InstalledGameInfo[]>(installedGames);
  installedGamesRef.current = installedGames;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  const launchGame = useCallback(
    async (game: InstalledGameInfo) => {
      const outcome = await launchInstalledGame({
        gameId: game.gameId,
        title: installedGameTitle(game),
        versionDirectory: game.versionDirectory,
        installationDirectory: game.installationDirectory,
      });
      const alert = launchOutcomeAlert(outcome);
      if (alert) showAlert(alert);
    },
    [showAlert],
  );

  /** Waits out the initial library scan before declaring a game missing. */
  const findInstalledGame = useCallback(async (gameId: number) => {
    const deadline = Date.now() + INSTALLED_GAMES_WAIT_MS;
    for (;;) {
      const found = installedGamesRef.current.find(
        (candidate) => candidate.gameId === gameId,
      );
      if (found) return found;
      // Nothing is loading any more, so waiting longer cannot help.
      if (!loadingRef.current) return undefined;
      if (Date.now() >= deadline) return undefined;
      await new Promise((resolve) =>
        setTimeout(resolve, INSTALLED_GAMES_POLL_MS),
      );
    }
  }, []);

  const runAction = useCallback(
    async (action: TrayActionPayload) => {
      if (action.kind === "navigate") {
        if (TRAY_ROUTES.has(action.value)) {
          navigate(`/${action.value}`);
        }
        return;
      }

      const game = await findInstalledGame(action.value);
      if (!game) {
        showAlert({
          title: "Game is not installed",
          description:
            "This game is no longer installed, so it cannot be launched from the tray menu.",
        });
        return;
      }
      await launchGame(game);
    },
    [findInstalledGame, launchGame, navigate, showAlert],
  );

  /** Empties the native action queue, in order. */
  const drainActions = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const actions = await invoke<TrayActionPayload[]>("take_tray_actions");
      for (const action of actions ?? []) {
        await runAction(action);
      }
    } catch (error) {
      console.warn("Failed to read pending tray actions:", error);
    }
  }, [runAction]);

  // Most recently used installed games (played or installed), newest first.
  const recentGames = useMemo<TrayRecentGame[]>(
    () => trayRecentGames(installedGames, RECENT_GAME_LIMIT),
    [installedGames],
  );

  // Push the list to the tray and the jump list. The last payload is
  // remembered so a library refetch with the same contents changes nothing.
  const sentRecentGamesRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isTauriApp()) return;

    const serialized = JSON.stringify(recentGames);
    if (sentRecentGamesRef.current === serialized) return;
    sentRecentGamesRef.current = serialized;

    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_tray_recent_games", { games: recentGames });
      } catch (error) {
        // Non-critical: the menus simply keep the previous list.
        console.warn("Failed to update the tray menu:", error);
      }
    })();
  }, [recentGames]);

  // Actions requested before the window was ready (a cold start from a jump
  // list entry) are queued natively, so pull them once we are listening.
  useEffect(() => {
    if (!isTauriApp()) return;
    void drainActions();
  }, [drainActions]);

  // Actions requested while running (tray menu clicks, or a second instance
  // forwarding a jump list entry).
  useEffect(() => {
    if (!isTauriApp()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen(ACTIONS_PENDING_EVENT, () => {
          void drainActions();
        });
        if (disposed) stop();
        else unlisten = stop;
      } catch (error) {
        console.warn(`Could not subscribe to ${ACTIONS_PENDING_EVENT}:`, error);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [drainActions]);
}
