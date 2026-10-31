import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import GamepadNavigator from "@/components/GamepadNavigator";
import { GamepadHints } from "@/components/GamepadHints";
import {
  startGamepadInput,
  stopGamepadInput,
  subscribeGamepadConnection,
  subscribeGamepadInput,
} from "@/utils/gamepad";

/** Hide the control hints after this long without gamepad input. */
const HINTS_IDLE_MS = 25_000;

interface GamepadContextValue {
  /** Whether at least one gamepad is currently connected. */
  connected: boolean;
  /**
   * Whether the controller is the active input device. True after gamepad
   * input (or a fresh connection), false again after mouse/touch use or a few
   * idle seconds. Drives the on-screen control hints.
   */
  active: boolean;
}

const GamepadContext = createContext<GamepadContextValue | null>(null);

/**
 * Polls the Web Gamepad API for the app's lifetime and mounts the global
 * navigation engine. Must live inside the router so the engine can navigate.
 */
export function GamepadProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let idleTimer: number | null = null;
    const markActive = () => {
      setActive(true);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        idleTimer = null;
        setActive(false);
      }, HINTS_IDLE_MS);
    };

    const unsubscribeConnection = subscribeGamepadConnection((isConnected) => {
      setConnected(isConnected);
      // Show the controls once when a controller appears, so a couch setup
      // immediately sees what the buttons do.
      if (isConnected) markActive();
    });
    const unsubscribeFrames = subscribeGamepadInput((frame) => {
      if (
        frame.direction !== null ||
        frame.justPressed.size > 0 ||
        frame.scrollX !== 0 ||
        frame.scrollY !== 0
      ) {
        markActive();
      }
    });
    const handlePointerDown = () => setActive(false);
    // A real mouse/trackpad movement means the pointer is back in use, so the
    // console hints should get out of the way (same threshold as the cursor
    // mode in GamepadNavigator).
    let lastPointerX = 0;
    let lastPointerY = 0;
    const handlePointerMove = (event: MouseEvent) => {
      const moved =
        Math.abs(event.clientX - lastPointerX) +
        Math.abs(event.clientY - lastPointerY);
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      if (moved > 4) setActive(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("mousemove", handlePointerMove, true);

    startGamepadInput();
    return () => {
      unsubscribeConnection();
      unsubscribeFrames();
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("mousemove", handlePointerMove, true);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      stopGamepadInput();
    };
  }, []);

  const value = useMemo(() => ({ connected, active }), [connected, active]);

  return (
    <GamepadContext.Provider value={value}>
      <GamepadNavigator />
      <GamepadHints />
      {children}
    </GamepadContext.Provider>
  );
}

export function useGamepad(): GamepadContextValue {
  const context = useContext(GamepadContext);
  if (!context) {
    throw new Error("useGamepad must be used within a GamepadProvider");
  }
  return context;
}
