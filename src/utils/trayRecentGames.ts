import type { InstalledGameInfo } from "@/hooks/useInstalledGames";

/**
 * The tray menu's "recently played" section.
 *
 * Steam only lists games you played. GameVault lists the most recently *used*
 * installed games instead, so a game shows up the moment it finishes
 * installing — having just installed something and then finding no quick way
 * back to it is the more annoying gap. Ordering therefore uses whichever
 * happened last: the game was played, or it was installed.
 */

export interface TrayRecentGame {
  gameId: number;
  title: string;
}

/** Display name of an installed game, preferring fresh server metadata. */
export function installedGameTitle(game: InstalledGameInfo): string {
  return game.gameTitle || game.cachedMetadata?.metadata?.title || "Game";
}

/**
 * When the user last touched an installed game. `0` means "never played and
 * installed before GameVault started recording install times".
 */
export function lastActivityAt(game: InstalledGameInfo): number {
  return Math.max(game.lastPlayedAt || 0, game.installedAt || 0);
}

/**
 * Newest-first installed games, ready to hand to the tray menu.
 *
 * Games without any timestamp are left out: the menu is a shortcut, and an
 * entry there can never be "recent" without a date. Ties break on the game id
 * so the list does not shuffle between refreshes.
 */
export function trayRecentGames(
  games: InstalledGameInfo[],
  limit: number,
): TrayRecentGame[] {
  return games
    .filter((game) => game.gameId > 0 && lastActivityAt(game) > 0)
    .map((game) => ({ game, activityAt: lastActivityAt(game) }))
    .sort(
      (a, b) => b.activityAt - a.activityAt || a.game.gameId - b.game.gameId,
    )
    .slice(0, limit)
    .map(({ game }) => ({
      gameId: game.gameId,
      title: installedGameTitle(game),
    }));
}
