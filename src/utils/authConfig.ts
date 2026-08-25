import { isTauriApp } from "./tauri";

export const AUTH_REFRESH_STORAGE_KEY = "app_refresh_token";
export const AUTH_SERVER_STORAGE_KEY = "app_server_url";
export const DEMO_SERVER_URL = "https://demo.gamevau.lt";

export interface DevAutologinConfig {
  server: string;
  username: string;
  password: string;
}

const truthyEnvPattern = /^(1|true|yes|on)$/i;

export function normalizeServerUrl(raw: string): string {
  let normalized = (raw || "").trim();
  if (!normalized) return "";
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/+$/, "");
}

export function getDevAutologinConfig(): DevAutologinConfig | null {
  if (!import.meta.env.DEV) return null;
  if (!truthyEnvPattern.test(import.meta.env.VITE_DEV_AUTOLOGIN ?? "")) {
    return null;
  }

  const server = normalizeServerUrl(
    import.meta.env.VITE_DEV_AUTOLOGIN_SERVER ?? "",
  );
  const username = (import.meta.env.VITE_DEV_AUTOLOGIN_USERNAME ?? "").trim();
  const password = import.meta.env.VITE_DEV_AUTOLOGIN_PASSWORD ?? "";

  if (!server || !username || !password) return null;

  return { server, username, password };
}

let backendServedCache: boolean | null = null;

/**
 * Detect whether the Web UI is being served by the GameVault backend it is
 * running inside of (same-origin). Used to lock the server to the backend and
 * hide the server selector entirely.
 */
export async function detectBackendServedWebUi(): Promise<boolean> {
  if (isTauriApp()) return false;
  if (backendServedCache !== null) return backendServedCache;

  let served = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${window.location.origin}/api/status`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      served =
        typeof data?.status === "string" ||
        typeof data?.version === "string" ||
        typeof data?.registration_enabled === "boolean";
    }
  } catch {
    served = false;
  }
  backendServedCache = served;
  return served;
}