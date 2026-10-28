/**
 * Launches an installed game through the native `launch_game` command.
 *
 * The launch options (executable, parameters, umu overrides) live in a
 * `.gamevault.game.config.json` file next to the installed version, written by
 * the game settings page. The library card, the game page and the system tray
 * all launch through here so those paths cannot drift apart.
 */

import { findInstalledGameById } from "@/utils/installedGames";
import { installedGameTitle } from "@/utils/trayRecentGames";

export interface InstalledGameLaunchTarget {
  gameId: number;
  /** Display name used in logs and error dialogs. */
  title: string;
  versionDirectory: string;
  installationDirectory: string;
}

export type LaunchOutcome =
  | { status: "launched" }
  | { status: "no-executable" }
  | { status: "failed"; message: string };

interface LaunchConfig {
  launchExecutable?: string;
  launchParameters?: string;
  runAsAdmin: boolean;
  umuGameId?: string;
  umuStore?: string;
  umuProtonPath?: string;
  umuWinePrefix?: string;
  forceUmu: boolean;
}

/** Reads the per-game launch config, tolerating a missing or broken file. */
async function readLaunchConfig(configPath: string): Promise<LaunchConfig> {
  const { invoke } = await import("@tauri-apps/api/core");
  const empty: LaunchConfig = { runAsAdmin: false, forceUmu: false };

  if (!(await invoke<boolean>("fs_path_exists", { path: configPath }))) {
    return empty;
  }

  try {
    const raw = JSON.parse(
      await invoke<string>("fs_read_text_file", { path: configPath }),
    );
    return {
      launchExecutable: raw.launchexecutable,
      launchParameters: raw.launchparameters,
      runAsAdmin: !!raw.launchasadmin,
      umuGameId: raw.umugameid,
      umuStore: raw.umustore,
      umuProtonPath: raw.umuprotonpath,
      umuWinePrefix: raw.umuwineprefix,
      forceUmu: !!raw.forceumu,
    };
  } catch {
    console.warn("Failed to parse game config:", configPath);
    return empty;
  }
}

/**
 * Starts an installed game and reports what happened, so every caller can show
 * the same message for the same failure.
 */
export async function launchInstalledGame(
  target: InstalledGameLaunchTarget,
): Promise<LaunchOutcome> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { join } = await import("@tauri-apps/api/path");

    const config = await readLaunchConfig(
      await join(target.versionDirectory, ".gamevault.game.config.json"),
    );
    if (!config.launchExecutable) {
      return { status: "no-executable" };
    }

    await invoke("launch_game", {
      gameTitle: target.title,
      gameId: target.gameId,
      versionDirectory: target.versionDirectory,
      installationPath: target.installationDirectory,
      executableRelativePath: config.launchExecutable,
      launchParameters: config.launchParameters || null,
      runAsAdmin: config.runAsAdmin,
      umuGameId: config.umuGameId || null,
      umuStore: config.umuStore || null,
      umuProtonPath: config.umuProtonPath || null,
      umuWinePrefix: config.umuWinePrefix || null,
      forceUmu: config.forceUmu,
    });

    return { status: "launched" };
  } catch (error: any) {
    return { status: "failed", message: error?.message || String(error) };
  }
}

/**
 * Launches an installed game by id, for callers that have no installed-game
 * state of their own (deep links).
 *
 * Deliberately silent: a `gamevault://start` link for a game that is not
 * installed, has no executable configured, or whose executable is missing must
 * do nothing at all. Problems are only visible in the console.
 */
export async function launchInstalledGameById(gameId: number): Promise<void> {
  const game = await findInstalledGameById(gameId);
  if (!game) {
    console.warn(`Ignoring start link: game ${gameId} is not installed`);
    return;
  }

  const outcome = await launchInstalledGame({
    gameId: game.gameId,
    title: installedGameTitle(game),
    versionDirectory: game.versionDirectory,
    installationDirectory: game.installationDirectory,
  });

  if (outcome.status !== "launched") {
    console.warn(`Ignoring start link for game ${gameId}: ${outcome.status}`);
  }
}

/**
 * Turns a failed launch into the dialog every caller shows, so a game that
 * cannot start reads the same whether it was launched from the library, the
 * game page or the tray menu. Returns `null` for a successful launch.
 */
export function launchOutcomeAlert(
  outcome: LaunchOutcome,
): { title: string; description: string } | null {
  switch (outcome.status) {
    case "launched":
      return null;
    case "no-executable":
      return {
        title: "No launch executable configured",
        description:
          "Open Game Settings → Launch Options to select an executable first.",
      };
    case "failed":
      return { title: "Failed to launch game", description: outcome.message };
  }
}
