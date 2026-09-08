// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { emitGameUpdated, onGameUpdated } from "./gameUpdates";

describe("game updated events", () => {
  it("emits the game detail to subscribers", () => {
    const listener = vi.fn();
    const off = onGameUpdated(listener);
    const game = { id: 7, title: "Game" } as any;
    emitGameUpdated(game);
    expect(listener).toHaveBeenCalledWith(game);
    off();
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const off = onGameUpdated(listener);
    off();
    emitGameUpdated({ id: 8 } as any);
    expect(listener).not.toHaveBeenCalled();
  });
});
