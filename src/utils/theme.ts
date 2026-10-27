import { useEffect, useState } from "react";

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

/**
 * Applies a theme mode. By default the explicit choice is persisted to
 * localStorage. Pass `persist: false` for a temporary, visual-only switch
 * (e.g. the login page forcing the device theme) so the user's saved
 * preference is never erased — a reload while the login page is showing
 * would otherwise permanently lose the chosen theme.
 */
export function applyTheme(mode: ThemeMode, persist = true): void {
  const isDark = resolveIsDark(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);

  try {
    if (persist) {
      if (mode === "system") {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, mode === "dark" ? "true" : "false");
      }
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

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof window !== "undefined" ? resolveIsDark(getStoredTheme()) : false,
  );

  useEffect(() => {
    const apply = () => setIsDark(resolveIsDark(getStoredTheme()));
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        { darkMode?: boolean } | undefined;
      if (typeof detail?.darkMode === "boolean") {
        setIsDark(detail.darkMode);
      }
    };

    apply();
    window.addEventListener("darkMode", onThemeChange);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => {
      window.removeEventListener("darkMode", onThemeChange);
      media.removeEventListener("change", apply);
    };
  }, []);

  return isDark;
}
