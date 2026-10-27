import type { GamevaultGame } from "@/api/models/GamevaultGame";

const GAME_UPDATED_EVENT = "gamevault:game-updated";
const GAME_DELETED_EVENT = "gamevault:game-deleted";

export function emitGameUpdated(game: GamevaultGame): void {
  window.dispatchEvent(
    new CustomEvent<GamevaultGame>(GAME_UPDATED_EVENT, { detail: game }),
  );
}

export function onGameUpdated(
  callback: (game: GamevaultGame) => void,
): () => void {
  const listener = (event: Event) => {
    callback((event as CustomEvent<GamevaultGame>).detail);
  };
  window.addEventListener(GAME_UPDATED_EVENT, listener);
  return () => window.removeEventListener(GAME_UPDATED_EVENT, listener);
}

/**
 * Emitted when a game has been fully removed from the library (e.g. its last
 * version file was deleted). Consumers can drop the game from lists/caches and
 * navigate away from a now-empty game view.
 */
export function emitGameDeleted(gameId: number): void {
  window.dispatchEvent(
    new CustomEvent<number>(GAME_DELETED_EVENT, { detail: gameId }),
  );
}

export function onGameDeleted(
  callback: (gameId: number) => void,
): () => void {
  const listener = (event: Event) => {
    callback((event as CustomEvent<number>).detail);
  };
  window.addEventListener(GAME_DELETED_EVENT, listener);
  return () => window.removeEventListener(GAME_DELETED_EVENT, listener);
}