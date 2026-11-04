import { useEffect, useState } from "react";
import { onUiTranslationState } from "@/utils/domTranslation";
import { activeInterfaceTranslation } from "@/utils/interfaceTranslation";

/**
 * The language the interface is currently translated into, or null.
 *
 * Re-renders when a translation session starts or stops, e.g. when the model
 * finishes loading after the page mounted.
 */
export function useInterfaceTranslationLanguage(): string | null {
  const [language, setLanguage] = useState<string | null>(
    activeInterfaceTranslation,
  );

  useEffect(
    () => onUiTranslationState(() => setLanguage(activeInterfaceTranslation())),
    [],
  );

  return language;
}
