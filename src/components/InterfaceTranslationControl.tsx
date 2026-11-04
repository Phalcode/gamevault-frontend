import { useCallback, useEffect, useState } from "react";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { TrashIcon } from "@heroicons/react/24/outline";
import { trackEvent } from "@/utils/analytics";
import {
  deleteBergamotModel,
  downloadBergamotModel,
  getBergamotModelStatus,
} from "@/utils/bergamotEngine";
import {
  INTERFACE_TRANSLATION_OFF,
  applyInterfaceTranslation,
  interfaceTranslationLanguageLabel,
  loadInterfaceTranslationLanguages,
  readInterfaceTranslationLanguage,
  writeInterfaceTranslationLanguage,
  type InterfaceTranslationLanguage,
} from "@/utils/interfaceTranslation";
import { clearTranslationCache } from "@/utils/translationCache";

type ModelState = "unknown" | "missing" | "downloading" | "ready";

/**
 * Settings → Appearance → Interface translation.
 *
 * Picking a language downloads Mozilla's model for it (once) and switches the
 * running UI over. Picking "Off" restores the English original.
 */
export default function InterfaceTranslationControl() {
  const [language, setLanguage] = useState<string>(INTERFACE_TRANSLATION_OFF);
  const [modelState, setModelState] = useState<ModelState>("unknown");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<
    InterfaceTranslationLanguage[] | null
  >(null);
  const [languagesError, setLanguagesError] = useState<string | null>(null);

  const refreshModelState = useCallback(async (target: string) => {
    if (target === INTERFACE_TRANSLATION_OFF) {
      setModelState("missing");
      return;
    }
    try {
      const status = await getBergamotModelStatus(target);
      setModelState(status.ready ? "ready" : "missing");
    } catch {
      // Status unreadable (older build, missing store): assume not installed.
      setModelState("missing");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readInterfaceTranslationLanguage();
      if (cancelled) return;
      setLanguage(stored);
      await refreshModelState(stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshModelState]);

  // Only offer languages Mozilla actually publishes a model for. The list
  // comes from their registry, so it needs a connection the first time; it is
  // cached afterwards.
  useEffect(() => {
    let cancelled = false;
    void loadInterfaceTranslationLanguages()
      .then((available) => {
        if (!cancelled) setLanguages(available);
      })
      .catch(() => {
        if (!cancelled) {
          setLanguagesError(
            "Could not load the list of available languages. Check the internet connection.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = async (value: string) => {
    const previous = language;
    setLanguage(value);
    setError(null);
    await writeInterfaceTranslationLanguage(value);
    trackEvent("interface_translation_changed", { language: value });

    if (value === INTERFACE_TRANSLATION_OFF) {
      await applyInterfaceTranslation(INTERFACE_TRANSLATION_OFF);
      setModelState("missing");
      return;
    }

    try {
      const existing = await getBergamotModelStatus(value);
      if (!existing.ready) {
        setModelState("downloading");
        setProgress(0);
        // The backend only learns the size of the next archive when its
        // response arrives, so never let the bar move backwards.
        await downloadBergamotModel(value, (fraction) =>
          setProgress((previous) => Math.max(previous, fraction)),
        );
        const downloaded = await getBergamotModelStatus(value);
        if (!downloaded.ready) {
          throw new Error("The translation model could not be stored.");
        }
      }
      setModelState("ready");
      await applyInterfaceTranslation(value);
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure);
      setError(message);
      setLanguage(previous);
      await writeInterfaceTranslationLanguage(previous);
      await refreshModelState(previous);
      await applyInterfaceTranslation(previous).catch(() => undefined);
    }
  };

  const handleDeleteModel = async () => {
    if (language === INTERFACE_TRANSLATION_OFF) return;
    await applyInterfaceTranslation(INTERFACE_TRANSLATION_OFF);
    await writeInterfaceTranslationLanguage(INTERFACE_TRANSLATION_OFF);
    // The cache lives next to the model; drop it together with the archives.
    await clearTranslationCache(language);
    await deleteBergamotModel(language);
    setLanguage(INTERFACE_TRANSLATION_OFF);
    setModelState("missing");
    setError(null);
  };

  // A saved language that the (possibly unreachable) registry did not list
  // still has to be visible, otherwise the picker would claim "Off".
  const selectableLanguages: InterfaceTranslationLanguage[] = (() => {
    const available = languages ?? [];
    if (
      language === INTERFACE_TRANSLATION_OFF ||
      available.some((entry) => entry.code === language)
    ) {
      return available;
    }
    return [
      { code: language, label: interfaceTranslationLanguageLabel(language) },
      ...available,
    ];
  })();

  const statusText = (() => {
    if (error) return error;
    if (modelState === "downloading") {
      return `Downloading model… ${Math.round(progress * 100)}%`;
    }
    if (modelState === "ready") return "Runs offline.";
    if (language === INTERFACE_TRANSLATION_OFF) return languagesError;
    return "Downloading the model needs an internet connection once.";
  })();

  return (
    <div className="flex w-56 shrink-0 flex-col items-end gap-1.5">
      <Listbox
        name="interfaceTranslation"
        value={language}
        onChange={(value: unknown) => void handleSelect(String(value))}
        disabled={modelState === "downloading"}
      >
        <ListboxOption value={INTERFACE_TRANSLATION_OFF}>
          <ListboxLabel>Off (English)</ListboxLabel>
        </ListboxOption>
        {selectableLanguages.map((entry) => (
          <ListboxOption key={entry.code} value={entry.code}>
            <ListboxLabel>{entry.label}</ListboxLabel>
          </ListboxOption>
        ))}
      </Listbox>

      <div className="flex items-center gap-2 text-right">
        {statusText && (
          <span
            className={`text-[11px] leading-4 ${error ? "text-gv-danger" : "text-gv-muted"}`}
          >
            {statusText}
          </span>
        )}
        {modelState === "ready" && (
          <button
            type="button"
            onClick={() => void handleDeleteModel()}
            title="Delete the downloaded model"
            aria-label="Delete the downloaded translation model"
            className="rounded-md p-1 text-gv-muted transition hover:bg-gv-panel-soft hover:text-gv-text"
          >
            <TrashIcon className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
