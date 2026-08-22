import type { GamevaultGame } from "@/api/models/GamevaultGame";

const GAME_UPDATED_EVENT = "gamevault:game-updated";

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