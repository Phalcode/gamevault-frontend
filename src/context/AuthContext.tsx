import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  ReactNode,
} from "react";
import { AuthTokens, User } from "@/types/api";

interface LoginArgs {
  server: string;
  username: string;
  password: string;
}

interface AuthContextValue {
  serverUrl: string;
  auth: AuthTokens | null;
  user: User | null;
  error: string | null;
  loading: boolean;
  bootstrapping: boolean;
  loginBasic: (args: LoginArgs) => Promise<{ auth: AuthTokens; user: User }>;
  logout: () => void;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  refreshCurrentUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const REFRESH_KEY = "app_refresh_token";
const SERVER_KEY = "app_server_url";

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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authRef = useRef<AuthTokens | null>(null);
  const serverRef = useRef("");
  const nextTokenRefreshRef = useRef<Date | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

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
    });
    if (!res.ok)
      throw new Error(
        `Refresh failed (${res.status}): ${(await res.text()) || res.statusText}`,
      );
    return res.json();
  }
  async function fetchCurrentUser(): Promise<User> {
    const res = await authFetch(`${serverRef.current}/api/users/me`);
    if (!res.ok)
      throw new Error(
        `GET /api/users/me failed (${res.status}): ${(await res.text()) || res.statusText}`,
      );
    return res.json();
  }

  const isTokenNearExpiry = useCallback(() => {
    const nxt = nextTokenRefreshRef.current;
    if (!nxt) return true;
    const threshold = Date.now() + 60_000;
    return nxt.getTime() <= threshold;
  }, []);
  const performRefresh = useCallback(async () => {
    const refreshToken =
      authRef.current?.refresh_token || localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw new Error("Missing refresh token");
    const data = await refreshWithToken(refreshToken);
    if (!data?.access_token)
      throw new Error("Refresh response missing access_token");
    const merged: AuthTokens = { ...(authRef.current || {}), ...data };
    authRef.current = merged;
    setAuth(merged);
    if (merged.refresh_token)
      localStorage.setItem(REFRESH_KEY, merged.refresh_token);
    nextTokenRefreshRef.current = computeNextTokenRefresh(merged.access_token);
  }, []);
  const ensureFreshToken = useCallback(async () => {
    if (!authRef.current?.access_token) return;
    if (!isTokenNearExpiry()) return;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    refreshInFlightRef.current = (async () => {
      try {
        await performRefresh();
      } catch {
        logout();
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
      serverRef.current = (server || "").replace(/\/+$/, "");
      setServerUrl(serverRef.current);
      localStorage.setItem(SERVER_KEY, serverRef.current);
      try {
        if (!server || !username || !password)
          throw new Error("All fields are required.");
        const authData = await loginBasicRequest(username, password);
        authRef.current = authData;
        setAuth(authData);
        if (authData.refresh_token)
          localStorage.setItem(REFRESH_KEY, authData.refresh_token);
        nextTokenRefreshRef.current = authData.access_token
          ? computeNextTokenRefresh(authData.access_token)
          : new Date();
        const me = await fetchCurrentUser();
        setUser(me);
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

  useEffect(() => {
    (async () => {
      const storedRefresh = localStorage.getItem(REFRESH_KEY);
      const storedServer = localStorage.getItem(SERVER_KEY);
      if (!storedRefresh || !storedServer) {
        setBootstrapping(false);
        return;
      }
      serverRef.current = storedServer.replace(/\/+$/, "");
      setServerUrl(serverRef.current);
      try {
        const tokens = await refreshWithToken(storedRefresh);
        if (!tokens.access_token)
          throw new Error("No access_token in refresh response");
        authRef.current = tokens;
        setAuth(tokens);
        if (tokens.refresh_token)
          localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
        nextTokenRefreshRef.current = computeNextTokenRefresh(
          tokens.access_token,
        );
        const me = await fetchCurrentUser();
        setUser(me);
      } catch {
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(SERVER_KEY);
        authRef.current = null;
        setAuth(null);
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const logout = useCallback(() => {
    authRef.current = null;
    nextTokenRefreshRef.current = null;
    setAuth(null);
    setUser(null);
    setError(null);
    localStorage.removeItem(REFRESH_KEY);
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
    loginBasic,
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
