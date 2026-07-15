export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "darkMode";

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "true") return "dark";
    if (v === "false") return "light";
  } catch {
    // localStorage unavailable
  }
  return "system";
}

export function applyTheme(mode: ThemeMode): void {
  const isDark = resolveIsDark(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);

  try {
    if (mode === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode === "dark" ? "true" : "false");
    }
  } catch {
    // localStorage unavailable
  }

  // Notify other use-dark-mode hooks (Logo, etc.)
  try {
    window.dispatchEvent(
      new CustomEvent("darkMode", { detail: { darkMode: isDark } }),
    );
  } catch {
    // events unavailable
  }
}
