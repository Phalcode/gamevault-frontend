import { useEffect } from "react";
import { isTauriApp } from "@/utils/tauri";
import {
  INTERFACE_TRANSLATION_OFF,
  applyInterfaceTranslation,
  isInterfaceTranslationAvailable,
  readInterfaceTranslationLanguage,
} from "@/utils/interfaceTranslation";

/**
 * Applies the saved interface translation once on startup.
 *
 * Nothing happens when no language is selected, when the model has not been
 * downloaded yet, or in the web build, where the browser translates the page.
 * Navigation needs no hook: the DOM translator observes the document and picks
 * up text React renders later.
 */
export default function InterfaceTranslationBoot() {
  useEffect(() => {
    if (!isTauriApp()) return;
    let cancelled = false;

    void (async () => {
      const stored = await readInterfaceTranslationLanguage();
      if (cancelled || stored === INTERFACE_TRANSLATION_OFF) return;

      const ready = await isInterfaceTranslationAvailable(stored)
        .then((status) => status.ready)
        .catch(() => false);
      if (cancelled || !ready) return;

      // Failures (engine blocked, corrupt model) keep the English UI.
      await applyInterfaceTranslation(stored).catch(() => undefined);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
