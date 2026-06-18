export const AUTH_REFRESH_STORAGE_KEY = "app_refresh_token";
export const AUTH_SERVER_STORAGE_KEY = "app_server_url";

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