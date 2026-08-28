import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { GamevaultUser } from "../api";
import { AuthTokens } from "../types/AuthTokens";
import {
  AUTH_REFRESH_STORAGE_KEY,
  AUTH_SERVER_STORAGE_KEY,
  getDevAutologinConfig,
  normalizeServerUrl,
} from "@/utils/authConfig";
import { isTauriApp } from "@/utils/tauri";
import { useOnlineStatus } from "@/context/OfflineContext";

const AUTH_CACHED_USER_KEY = "app_cached_user";

interface LoginArgs {
  server: string;
  username: string;
  password: string;
}

interface AuthContextValue {
  serverUrl: string;
  auth: AuthTokens | null;
  user: GamevaultUser | null;
  error: string | null;
  loading: boolean;
  bootstrapping: boolean;
  /** True when the app started in offline mode (cached credentials used) */
  offlineBootstrap: boolean;
  loginBasic: (
    args: LoginArgs,
  ) => Promise<{ auth: AuthTokens; user: GamevaultUser }>;
  /** Directly initialize auth state from already obtained tokens (e.g. SSO redirect). */
  loginWithTokens: (
    server: string,
    tokens: AuthTokens,
  ) => Promise<{ auth: AuthTokens; user: GamevaultUser }>;
  logout: () => void;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  refreshCurrentUser: () => Promise<GamevaultUser | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface InternalJwtPayload {
  exp?: number;
  Exp?: number;
  iat?: number;
  Iat?: number;
  creation?: number;
  Creation?: number;
  [k: string]: any;
}

function base64UrlDecode(segment: string): string {
  try {
    let s = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4;
    if (pad) s += "=".repeat(4 - pad);
    if (typeof atob === "function") return atob(s);
    // Fallback minimal polyfill (browser-only target; Node Buffer not available without types)
    // If atob missing (older env), attempt TextDecoder on Uint8Array decode path
    if (typeof window === "undefined") return "";
    // @ts-ignore - TypeScript may not know atob is defined in some envs
    return atob(s);
  } catch {
    return "";
  }
}
function parseJwt(token: string): InternalJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function computeNextTokenRefresh(token: string): Date {
  const payload = parseJwt(token);
  if (!payload) return new Date();
  const exp = payload.Exp ?? payload.exp;
  const creation =
    payload.Creation ?? payload.creation ?? payload.iat ?? payload.Iat;
  const now = Date.now();
  if (
    typeof exp === "number" &&
    typeof creation === "number" &&
    exp > creation
  ) {
    const lifetimeSec = exp - creation;
    return new Date(now + lifetimeSec * 1000);
  } else if (typeof exp === "number") {
    return new Date(exp * 1000);
  }
  return new Date();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [serverUrl, setServerUrl] = useState("");
  const [auth, setAuth] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<GamevaultUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [offlineBootstrap, setOfflineBootstrap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bootstrapRanRef = useRef(false);

  const authRef = useRef<AuthTokens | null>(null);
  const serverRef = useRef("");
  const nextTokenRefreshRef = useRef<Date | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  /** When true, ensureFreshToken is a no-op — used during offline mode */
  const offlineModeRef = useRef(false);
  /** Cooldown timestamp (ms) — skip refresh retries until after this time */
  const offlineRefreshCooldownRef = useRef(0);

  const { onReconnect } = useOnlineStatus();

  async function loginBasicRequest(
    username: string,
    password: string,
  ): Promise<AuthTokens> {
    const res = await fetch(`${serverRef.current}/api/auth/basic/login`, {
      method: "GET",
      headers: {
        Authorization: "Basic " + btoa(`${username}:${password}`),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new Error(
        `Login failed (${res.status}): ${(await res.text()) || res.statusText}`,
      );
    return res.json();
  }
  async function refreshWithToken(refreshToken: string): Promise<AuthTokens> {
    const res = await fetch(`${serverRef.current}/api/auth/refresh`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + refreshToken,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new Error(
        `Refresh failed (${res.status}): ${(await res.text()) || res.statusText}`,
      );
    return res.json();
  }
  async function fetchCurrentUser(): Promise<GamevaultUser> {
    const res = await authFetch(`${serverRef.current}/api/users/me`);
    if (!res.ok)
      throw new Error(
        `GET /api/users/me failed (${res.status}): ${(await res.text()) || res.statusText}`,
      );
    const me: GamevaultUser = await res.json();
    // Always cache user for offline bootstrap (Tauri only)
    if (isTauriApp()) {
      try {
        localStorage.setItem(AUTH_CACHED_USER_KEY, JSON.stringify(me));
      } catch { /* ignore */ }
    }
    return me;
  }

  const isTokenNearExpiry = useCallback(() => {
    const nxt = nextTokenRefreshRef.current;
    if (!nxt) return true;
    const threshold = Date.now() + 60_000;
    return nxt.getTime() <= threshold;
  }, []);
  const performRefresh = useCallback(async () => {
    const refreshToken =
      authRef.current?.refresh_token ||
      localStorage.getItem(AUTH_REFRESH_STORAGE_KEY);
    if (!refreshToken) throw new Error("Missing refresh token");
    const data = await refreshWithToken(refreshToken);
    if (!data?.access_token)
      throw new Error("Refresh response missing access_token");
    const merged: AuthTokens = { ...(authRef.current || {}), ...data };
    authRef.current = merged;
    setAuth(merged);
    if (merged.refresh_token)
      localStorage.setItem(
        AUTH_REFRESH_STORAGE_KEY,
        merged.refresh_token,
      );
    nextTokenRefreshRef.current = computeNextTokenRefresh(merged.access_token);
    offlineModeRef.current = false; // successfully refreshed, exit offline mode
  }, []);
  const ensureFreshToken = useCallback(async () => {
    // In offline mode: try the refresh. If network fails, stay offline silently.
    // If it succeeds, performRefresh clears offlineModeRef and we exit offline mode.
    if (offlineModeRef.current) {
      console.log("[auth] ensureFreshToken: offline mode, attempting refresh...");
      // Cooldown: don't spam failed refresh attempts while truly offline
      if (Date.now() < offlineRefreshCooldownRef.current) {
        console.log("[auth] ensureFreshToken: refresh cooldown active, skipping");
        return;
      }
      if (refreshInFlightRef.current) return refreshInFlightRef.current;
      refreshInFlightRef.current = (async () => {
        try {
          await performRefresh();
          console.log("[auth] ensureFreshToken: offline refresh SUCCEEDED, exiting offline mode");
        } catch (e) {
          // Network down — set cooldown and stay offline
          console.log("[auth] ensureFreshToken: offline refresh failed, cooldown 30s:", e instanceof Error ? e.message : String(e));
          offlineRefreshCooldownRef.current = Date.now() + 30_000;
        } finally {
          refreshInFlightRef.current = null;
        }
      })();
      return refreshInFlightRef.current;
    }
    // Normal online path
    if (!authRef.current?.access_token) { console.log("[auth] ensureFreshToken: no access_token"); return; }
    if (!isTokenNearExpiry()) return;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    refreshInFlightRef.current = (async () => {
      try {
        await performRefresh();
      } catch (e) {
        console.log("[auth] normal refresh failed:", e instanceof Error ? e.message : String(e));
        // Network error while online? If Tauri + stored creds, re-enter offline mode.
        // Only logout if this is a genuine auth failure (not a network blip).
        if (isTauriApp() && localStorage.getItem(AUTH_REFRESH_STORAGE_KEY)) {
          console.log("[auth] network failure, re-entering offline mode");
          offlineModeRef.current = true;
          offlineRefreshCooldownRef.current = Date.now() + 30_000;
        } else {
          logout();
        }
      } finally {
        refreshInFlightRef.current = null;
      }
    })();
    return refreshInFlightRef.current;
  }, [isTokenNearExpiry, performRefresh]);

  const authFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      await ensureFreshToken();
      const token = authRef.current?.access_token;
      const headers = new Headers(init?.headers || {});
      if (token && !headers.has("Authorization"))
        headers.set("Authorization", "Bearer " + token);
      headers.set("Accept", "*/*");
      return fetch(input, { ...(init || {}), headers });
    },
    [ensureFreshToken],
  );

  const loginBasic = useCallback(
    async ({ server, username, password }: LoginArgs) => {
      setError(null);
      setLoading(true);
      setUser(null);
      setAuth(null);
      authRef.current = null;
      nextTokenRefreshRef.current = null;
      serverRef.current = normalizeServerUrl(server);
      setServerUrl(serverRef.current);
      localStorage.setItem(AUTH_SERVER_STORAGE_KEY, serverRef.current);
      try {
        if (!server || !username || !password)
          throw new Error("All fields are required.");
        const authData = await loginBasicRequest(username, password);
        authRef.current = authData;
        setAuth(authData);
        if (authData.refresh_token)
          localStorage.setItem(
            AUTH_REFRESH_STORAGE_KEY,
            authData.refresh_token,
          );
        nextTokenRefreshRef.current = authData.access_token
          ? computeNextTokenRefresh(authData.access_token)
          : new Date();
        const me = await fetchCurrentUser();
        setUser(me);
        if (isTauriApp()) {
          try {
            localStorage.setItem(AUTH_CACHED_USER_KEY, JSON.stringify(me));
          } catch { /* ignore */ }
        }
        return { auth: authData, user: me };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
        setBootstrapping(false);
      }
    },
    [],
  );

  const loginWithTokens = useCallback(
    async (server: string, tokens: AuthTokens) => {
      setError(null);
      setLoading(true);
      setUser(null);
      setAuth(null);
      authRef.current = null;
      nextTokenRefreshRef.current = null;
      serverRef.current = normalizeServerUrl(server);
      setServerUrl(serverRef.current);
      localStorage.setItem(AUTH_SERVER_STORAGE_KEY, serverRef.current);
      try {
        if (!tokens?.access_token) throw new Error("Missing access token");
        authRef.current = tokens;
        setAuth(tokens);
        if (tokens.refresh_token)
          localStorage.setItem(
            AUTH_REFRESH_STORAGE_KEY,
            tokens.refresh_token,
          );
        nextTokenRefreshRef.current = computeNextTokenRefresh(
          tokens.access_token,
        );
        const me = await fetchCurrentUser();
        setUser(me);
        if (isTauriApp()) {
          try {
            localStorage.setItem(AUTH_CACHED_USER_KEY, JSON.stringify(me));
          } catch { /* ignore */ }
        }
        return { auth: tokens, user: me };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
        setBootstrapping(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Guard against React StrictMode double-mount.
    if (bootstrapRanRef.current) return;
    bootstrapRanRef.current = true;

    (async () => {
      const storedRefresh = localStorage.getItem(AUTH_REFRESH_STORAGE_KEY);
      const storedServer = localStorage.getItem(AUTH_SERVER_STORAGE_KEY);
      console.log("[bootstrap] storedRefresh:", !!storedRefresh, "storedServer:", !!storedServer, "isTauri:", isTauriApp());
      if (!storedRefresh || !storedServer) {
        const devAutologin = getDevAutologinConfig();
        if (!devAutologin) {
          setBootstrapping(false);
          return;
        }

        setLoading(true);
        setError(null);
        serverRef.current = devAutologin.server;
        setServerUrl(serverRef.current);
        localStorage.setItem(AUTH_SERVER_STORAGE_KEY, serverRef.current);
        try {
          const tokens = await loginBasicRequest(
            devAutologin.username,
            devAutologin.password,
          );
          if (!tokens.access_token) {
            throw new Error("No access_token in dev autologin response");
          }
          authRef.current = tokens;
          setAuth(tokens);
          if (tokens.refresh_token) {
            localStorage.setItem(
              AUTH_REFRESH_STORAGE_KEY,
              tokens.refresh_token,
            );
          }
          nextTokenRefreshRef.current = computeNextTokenRefresh(
            tokens.access_token,
          );
          const me = await fetchCurrentUser();
          setUser(me);
        } catch (e) {
          authRef.current = null;
          setAuth(null);
          setUser(null);
          nextTokenRefreshRef.current = null;
          localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
          setError(
            e instanceof Error ? e.message : "Dev autologin failed.",
          );
        } finally {
          setLoading(false);
          setBootstrapping(false);
        }
        return;
      }
      serverRef.current = normalizeServerUrl(storedServer);
      setServerUrl(serverRef.current);
      offlineModeRef.current = false;

      // Safety: force offline bootstrap if network calls hang > 15s
      const safetyTimer = isTauriApp()
        ? setTimeout(() => {
            console.log("[bootstrap] SAFETY TIMER FIRED — forcing offline");
            const cachedUserRaw = localStorage.getItem(AUTH_CACHED_USER_KEY);
            console.log("[bootstrap] safety: cachedUser exists:", !!cachedUserRaw);
            if (cachedUserRaw) {
              try {
                const cachedUser: GamevaultUser = JSON.parse(cachedUserRaw);
                offlineModeRef.current = true;
                authRef.current = { access_token: storedRefresh, refresh_token: storedRefresh };
                nextTokenRefreshRef.current = new Date(Date.now() + 24 * 60 * 60 * 1000);
                setAuth(authRef.current);
                setUser(cachedUser);
                setOfflineBootstrap(true);
              } catch { /* ignore */ }
            }
            setBootstrapping(false);
          }, 15_000)
        : null;

      try {
        console.log("[bootstrap] trying refreshWithToken...");
        const tokens = await refreshWithToken(storedRefresh);
        console.log("[bootstrap] refresh succeeded, fetching user...");
        if (!tokens.access_token)
          throw new Error("No access_token in refresh response");
        authRef.current = tokens;
        setAuth(tokens);
        if (tokens.refresh_token)
          localStorage.setItem(
            AUTH_REFRESH_STORAGE_KEY,
            tokens.refresh_token,
          );
        nextTokenRefreshRef.current = computeNextTokenRefresh(
          tokens.access_token,
        );
        const me = await fetchCurrentUser();
        setUser(me);
        if (isTauriApp()) {
          try {
            localStorage.setItem(AUTH_CACHED_USER_KEY, JSON.stringify(me));
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.log("[bootstrap] refresh/fetch failed:", e instanceof Error ? e.message : String(e));
        // In Tauri mode: if refresh fails (likely network error), try offline bootstrap
        if (isTauriApp()) {
          const cachedUserRaw = localStorage.getItem(AUTH_CACHED_USER_KEY);
          console.log("[bootstrap] cachedUser exists:", !!cachedUserRaw);
          if (cachedUserRaw) {
            try {
              const cachedUser: GamevaultUser = JSON.parse(cachedUserRaw);
              console.log("[bootstrap] entering OFFLINE MODE with cached user:", cachedUser.username);
              // Reconstruct minimal auth from stored refresh token
              offlineModeRef.current = true;
              authRef.current = { access_token: storedRefresh, refresh_token: storedRefresh };
              // Push expiry 24h out so ensureFreshToken won't try to refresh
              nextTokenRefreshRef.current = new Date(Date.now() + 24 * 60 * 60 * 1000);
              setAuth(authRef.current);
              setUser(cachedUser);
              setOfflineBootstrap(true);
            } catch {
              // Cache corrupted — clear it but keep refresh token so user can log in online
              localStorage.removeItem(AUTH_CACHED_USER_KEY);
              authRef.current = null;
              setAuth(null);
            }
          } else {
            // No cached user yet — keep refresh token so next online launch auto-logs in.
            // After one online session, app_cached_user will be populated.
            console.log("[bootstrap] no cached user, clearing auth (login page expected)");
            authRef.current = null;
            setAuth(null);
          }
        } else {
          localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
          authRef.current = null;
          setAuth(null);
        }
      } finally {
        if (safetyTimer) { clearTimeout(safetyTimer); console.log("[bootstrap] safety timer cleared"); }
        console.log("[bootstrap] done, bootstrapping=false, authRef:", !!authRef.current, "offlineBootstrap:", offlineBootstrap);
        setBootstrapping(false);
      }
    })();
  }, []);

  // When coming back online after offline mode, re-authenticate
  useEffect(() => {
    if (!isTauriApp()) return;

    const unregister = onReconnect(async () => {
      console.log("[auth] reconnect callback fired, refreshing...");
      // Don't clear offlineModeRef — let performRefresh handle it on success.
      // If refresh fails, ensureFreshToken's offline branch will retry with cooldown.
      const storedRefresh = localStorage.getItem(AUTH_REFRESH_STORAGE_KEY);
      if (!storedRefresh) return;

      try {
        const tokens = await refreshWithToken(storedRefresh);
        if (!tokens.access_token) throw new Error("No access_token");
        authRef.current = tokens;
        setAuth(tokens);
        if (tokens.refresh_token) {
          localStorage.setItem(AUTH_REFRESH_STORAGE_KEY, tokens.refresh_token);
        }
        nextTokenRefreshRef.current = computeNextTokenRefresh(tokens.access_token);
        offlineModeRef.current = false;
        // Re-fetch user data now that we're back online
        const me = await fetchCurrentUser();
        setUser(me);
        console.log("[auth] re-authenticated successfully");
      } catch (e) {
        console.log("[auth] reconnect refresh failed, staying offline:", e instanceof Error ? e.message : String(e));
      }
    });

    return unregister;
  }, [onReconnect]);

  const logout = useCallback(() => {
    offlineModeRef.current = false;
    authRef.current = null;
    nextTokenRefreshRef.current = null;
    setAuth(null);
    setUser(null);
    setError(null);
    localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
  }, []);

  const refreshCurrentUser = useCallback(async () => {
    try {
      const me = await fetchCurrentUser();
      setUser(me);
      return me;
    } catch {
      return null;
    }
  }, []);

  const value: AuthContextValue = {
    serverUrl,
    auth,
    user,
    error,
    loading,
    bootstrapping,
    offlineBootstrap,
    loginBasic,
    loginWithTokens,
    logout,
    authFetch,
    refreshCurrentUser,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
