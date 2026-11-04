import { useLayoutEffect } from "react";
import { isTauriApp } from "@/utils/tauri";
import {
  applyCachedUiTranslations,
  onUiTranslationState,
} from "@/utils/domTranslation";
import {
  applyInterfaceTranslation,
  preparedInterfaceTranslation,
  revealInterfaceTranslation,
} from "@/utils/interfaceTranslation";

/** Never keep the app hidden when the engine stalls or a batch hangs. */
const REVEAL_TIMEOUT_MS = 2000;

/**
 * Applies the saved interface translation on startup.
 *
 * `main.tsx` already loaded the translation cache and hid the app before the
 * first render. The cached pass runs here in a layout effect, so the first
 * paint is already translated. Only strings the cache does not know go to the
 * engine, and the app is revealed as soon as that first pass is done.
 */
export default function InterfaceTranslationBoot() {
  useLayoutEffect(() => {
    if (!isTauriApp()) return;

    const language = preparedInterfaceTranslation();
    if (!language) return;

    // Everything the cache knows is written before the browser paints.
    applyCachedUiTranslations(language);

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      revealInterfaceTranslation();
    };

    const unsubscribe = onUiTranslationState((state) => {
      if (state.status === "active" || state.status === "error") reveal();
    });
    const timeout = window.setTimeout(reveal, REVEAL_TIMEOUT_MS);

    void applyInterfaceTranslation(language).catch(reveal);

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  return null;
}
