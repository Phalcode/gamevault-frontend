import { FolderOpenIcon } from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/tailwind/button";
import {
  Combobox,
  ComboboxDescription,
  ComboboxLabel,
  ComboboxOption,
} from "@/components/tailwind/combobox";
import { Input } from "@/components/tailwind/input";
import { SettingsRow } from "@/components/tailwind/settings-row";
import {
  PROTON_AUTOMATIC,
  PROTON_CODENAMES,
  protonBuildSourceLabel,
  type ProtonBuild,
} from "@/models/proton";

/** The umu-launcher overrides of a game, in the order they are shown. */
export type UmuLaunchField =
  "umuGameId" | "umuStore" | "umuProtonPath" | "umuWinePrefix";

export interface UmuLaunchValues {
  umuGameId: string;
  umuStore: string;
  umuProtonPath: string;
  umuWinePrefix: string;
}

/** What a codename does, shown next to the matching dropdown entry. */
const CODENAME_HINTS: Record<string, string> = {
  [PROTON_AUTOMATIC]: "Automatic — umu picks the newest UMU-Proton",
  "GE-Proton": "Automatic — umu picks the newest GE-Proton",
};

/** Labels of the rows, also used as accessible names of the controls. */
const FIELD_LABELS: Record<UmuLaunchField, string> = {
  umuGameId: "Game ID",
  umuStore: "Store",
  umuProtonPath: "Proton version",
  umuWinePrefix: "Wine prefix",
};

interface UmuLaunchFieldsProps {
  values: UmuLaunchValues;
  onChange: (field: UmuLaunchField, value: string) => void;
  /** Proton builds the user has installed in `compatibilitytools.d`. */
  protonBuilds: ProtonBuild[];
  /** Wine/Proton prefix the game will actually use, if it is known. */
  resolvedPrefixPath?: string | null;
  onOpenPrefixFolder?: (path: string) => void;
  /** Desktop build: enables hints for the local Proton installation. */
  desktop?: boolean;
}

/**
 * The umu-launcher launch overrides (GAMEID, STORE, PROTONPATH, WINEPREFIX)
 * as a borderless list of rows, meant to live inside the Wine/Proton section
 * of the launch options.
 */
export function UmuLaunchFields({
  values,
  onChange,
  protonBuilds,
  resolvedPrefixPath,
  onOpenPrefixFolder,
  desktop = false,
}: UmuLaunchFieldsProps) {
  const [copiedPrefix, setCopiedPrefix] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const protonOptions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [
      ...PROTON_CODENAMES,
      ...protonBuilds.map((build) => build.name),
    ]) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }, [protonBuilds]);

  const protonHints = useMemo(() => {
    const hints = new Map<string, string>(Object.entries(CODENAME_HINTS));
    for (const build of protonBuilds) {
      hints.set(build.name, protonBuildSourceLabel(build.source));
    }
    return hints;
  }, [protonBuilds]);

  const renderTextInput = (field: UmuLaunchField, placeholder: string) => (
    <Input
      type="text"
      name={field}
      aria-label={FIELD_LABELS[field]}
      value={values[field] ?? ""}
      onChange={(event) => onChange(field, event.target.value)}
      placeholder={placeholder}
    />
  );

  const copyPrefixPath = (path: string) => {
    const copy = navigator.clipboard?.writeText(path);
    if (!copy) return;
    void copy.then(
      () => {
        setCopiedPrefix(true);
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
        copyTimer.current = window.setTimeout(
          () => setCopiedPrefix(false),
          1500,
        );
      },
      () => setCopiedPrefix(false),
    );
  };

  const rows = (
    <div className="divide-y divide-gv-line">
      <SettingsRow
        label={FIELD_LABELS.umuGameId}
        description="umu-database ID, e.g. 1811260. Used together with the store to apply protonfixes automatically."
      >
        {renderTextInput("umuGameId", "umu-default")}
      </SettingsRow>

      <SettingsRow
        label={FIELD_LABELS.umuStore}
        description="Storefront the game came from, e.g. steam, gog, epic."
      >
        {renderTextInput("umuStore", "e.g. gog, epic, ubisoft-connect")}
      </SettingsRow>

      <SettingsRow
        label={FIELD_LABELS.umuProtonPath}
        description="Pick one of your installed builds or type a folder name or codename. Leave empty for umu's default."
      >
        <Combobox
          name="umuProtonPath"
          value={values.umuProtonPath || undefined}
          onChange={(value: string | null) =>
            onChange("umuProtonPath", value ?? "")
          }
          onQueryChange={(query) => onChange("umuProtonPath", query)}
          options={protonOptions}
          displayValue={(value) => value ?? ""}
          placeholder="Automatic (umu default)"
          aria-label={FIELD_LABELS.umuProtonPath}
        >
          {(options) => (
            <>
              {options.map((option) => (
                <ComboboxOption key={option} value={option}>
                  <ComboboxLabel>{option}</ComboboxLabel>
                  <ComboboxDescription>
                    {protonHints.get(option) ?? ""}
                  </ComboboxDescription>
                </ComboboxOption>
              ))}
            </>
          )}
        </Combobox>
        {desktop && protonBuilds.length === 0 && (
          <p className="mt-1.5 text-xs text-gv-muted">
            No Proton builds found in compatibilitytools.d — install one with
            ProtonUp-Qt to pick it here.
          </p>
        )}
      </SettingsRow>

      <SettingsRow
        label={FIELD_LABELS.umuWinePrefix}
        description="Leave empty to let GameVault keep its own folder per game (named after the install folder) inside the Wine/Proton prefix directory from the settings."
      >
        {renderTextInput("umuWinePrefix", "Automatic (per game)")}
        {resolvedPrefixPath && (
          <div className="mt-1.5 flex items-start gap-2">
            <button
              type="button"
              onClick={() => copyPrefixPath(resolvedPrefixPath)}
              title={copiedPrefix ? "Copied" : `Copy ${resolvedPrefixPath}`}
              className="min-w-0 flex-1 wrap-break-word text-left font-mono text-[11px] leading-4 text-gv-muted hover:text-gv-text"
            >
              {copiedPrefix ? "Copied to clipboard" : resolvedPrefixPath}
            </button>
            {onOpenPrefixFolder && (
              <Button
                plain
                className="shrink-0 px-2 py-1.5 text-xs"
                onClick={() => onOpenPrefixFolder(resolvedPrefixPath)}
              >
                <FolderOpenIcon data-slot="icon" />
                Open folder
              </Button>
            )}
          </div>
        )}
      </SettingsRow>
    </div>
  );

  return rows;
}
