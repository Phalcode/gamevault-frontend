import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import GamepadNavigator from "@/components/GamepadNavigator";
import {
  startGamepadInput,
  stopGamepadInput,
  subscribeGamepadConnection,
} from "@/utils/gamepad";

interface GamepadContextValue {
  /** Whether at least one gamepad is currently connected. */
  connected: boolean;
}

const GamepadContext = createContext<GamepadContextValue | null>(null);

/**
 * Polls the Web Gamepad API for the app's lifetime and mounts the global
 * navigation engine. Must live inside the router so the engine can navigate.
 */
export function GamepadProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeGamepadConnection(setConnected);
    startGamepadInput();
    return () => {
      unsubscribe();
      stopGamepadInput();
    };
  }, []);

  const value = useMemo(() => ({ connected }), [connected]);

  return (
    <GamepadContext.Provider value={value}>
      <GamepadNavigator />
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
