import { pickPreferredExecutable } from "./install-utils";

/**
 * Server-provided launch defaults for a game.
 *
 * The server exposes these as custom metadata; Linux clients additionally use
 * the umu-launcher fields (GAMEID/STORE/PROTONPATH).
 */
export interface LaunchDefaults {
  /** Default launch executable. */
  launchExecutable?: string;
  /** Default launch parameters. */
  launchParameters?: string;
  /** umu-launcher GAMEID. */
  umuGameId?: string;
  /** umu-launcher STORE. */
  umuStore?: string;
  /** umu-launcher PROTONPATH (Proton build folder name). */
  umuProtonPath?: string;
}

/** Local `.gamevault.game.config.json` shape (only the launch-related keys). */
export type LocalLaunchConfig = Record<string, unknown> & {
  launchexecutable?: string;
  launchparameters?: string;
  umugameid?: string;
  umustore?: string;
  umuprotonpath?: string;
};

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result ? result : undefined;
}

/**
 * Fills unset launch options from the server defaults.
 *
 * Everything the user configured locally always wins:
 * - the executable/parameters pair is only auto-filled while both are empty
 *   (a manually chosen executable means the user owns the parameters too),
 * - each umu override is filled independently.
 *
 * Returns the updated config, or `null` when there is nothing to change (so
 * callers can skip the file write).
 */
export function mergeLaunchDefaults(
  current: LocalLaunchConfig,
  defaults: LaunchDefaults,
  executableOptions: string[],
): LocalLaunchConfig | null {
  const next: LocalLaunchConfig = { ...current };

  if (!next.launchexecutable && !next.launchparameters) {
    const resolvedExe = pickPreferredExecutable(
      executableOptions,
      trimmed(defaults.launchExecutable),
    );
    if (resolvedExe) next.launchexecutable = resolvedExe;

    const resolvedParams = trimmed(defaults.launchParameters);
    if (resolvedParams) next.launchparameters = resolvedParams;
  }

  const umuFields: [keyof LocalLaunchConfig, string | undefined][] = [
    ["umugameid", defaults.umuGameId],
    ["umustore", defaults.umuStore],
    ["umuprotonpath", defaults.umuProtonPath],
  ];
  for (const [key, value] of umuFields) {
    const resolved = trimmed(value);
    if (!next[key] && resolved) next[key] = resolved;
  }

  const changed =
    Object.keys(next).length !== Object.keys(current).length ||
    Object.entries(next).some(([key, value]) => current[key] !== value);

  return changed ? next : null;
}
