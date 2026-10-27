/**
 * Proton builds that are already installed on this machine.
 *
 * Discovered by the `list_proton_builds` command in the `compatibilitytools.d`
 * folders of Steam (native and Flatpak) and umu itself, so a PROTONPATH does
 * not have to be typed from memory.
 */
export interface ProtonBuild {
  /** Folder name inside `compatibilitytools.d`, e.g. `GE-Proton11-6`. */
  name: string;
  /** Absolute path of the build folder. */
  path: string;
  /** The `compatibilitytools.d` folder the build was found in. */
  source: string;
}

/**
 * Known `compatibilitytools.d` locations mapped to a short, user-facing label.
 * Checked in order, so the Flatpak location wins over the Steam fallback.
 */
const PROTON_BUILD_SOURCES: { match: string; label: string }[] = [
  { match: ".var/app/com.valvesoftware.Steam", label: "Steam (Flatpak)" },
  { match: ".local/share/umu", label: "umu" },
  { match: ".local/share/Steam", label: "Steam" },
  { match: ".steam/steam", label: "Steam" },
  { match: ".steam/root", label: "Steam" },
];

/**
 * Names the folder a Proton build was found in, e.g. `Steam (Flatpak)`.
 * Unknown folders fall back to their last path segment.
 */
export function protonBuildSourceLabel(source: string | undefined): string {
  if (!source) return "compatibilitytools.d";
  const normalized = source.replace(/\\/g, "/");
  for (const { match, label } of PROTON_BUILD_SOURCES) {
    if (normalized.includes(match)) return label;
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 0
    ? segments[segments.length - 1]
    : "compatibilitytools.d";
}

/**
 * umu codenames: instead of a concrete build folder they select the newest
 * build of that family. `UMU-Proton` doubles as umu's own default.
 */
export const PROTON_AUTOMATIC = "UMU-Proton";
export const PROTON_CODENAMES = [PROTON_AUTOMATIC, "GE-Proton"];
