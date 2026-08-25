import { useAuth } from "@/context/AuthContext";
import {
  AUTH_SERVER_STORAGE_KEY,
  DEMO_PASSWORD,
  DEMO_SERVER_URL,
  DEMO_USERNAME,
  detectBackendServedWebUi,
  getDevAutologinConfig,
  normalizeServerUrl,
} from "@/utils/authConfig";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useNavigate } from "react-router";
import { Status } from "../api";
import { applyTheme, getStoredTheme } from "@/utils/theme";

export function Login() {
  const { loginBasic, loginWithTokens, loading, error } = useAuth();
  const navigate = useNavigate();
  const devAutologin = getDevAutologinConfig();
  const [server, setServer] = useState(() => {
    return (
      localStorage.getItem(AUTH_SERVER_STORAGE_KEY) ||
      devAutologin?.server ||
      DEMO_SERVER_URL
    );
  });
  const [confirmedServer, setConfirmedServer] = useState<string | null>(() => {
    const initialServer =
      localStorage.getItem(AUTH_SERVER_STORAGE_KEY) || devAutologin?.server;
    return initialServer ? normalizeServerUrl(initialServer) : null;
  });
  const [username, setUsername] = useState(() => devAutologin?.username || "");
  const [password, setPassword] = useState(() => devAutologin?.password || "");
  const [useSso, setUseSso] = useState(false);
  const [serverStatus, setServerStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [backendServed, setBackendServed] = useState(false);

  // Force device theme on login page; restore stored preference on leave
  useEffect(() => {
    const stored = getStoredTheme();
    applyTheme("system");
    return () => applyTheme(stored);
  }, []);

  const basicAuthAvailable =
    serverStatus?.available_authentication_methods?.includes("basic") ?? true;
  const ssoAvailable =
    serverStatus?.available_authentication_methods?.includes("sso") ?? true;
  const noAuthAvailable = !basicAuthAvailable && !ssoAvailable;

  // Refs for focus trap
  const serverRef = useRef<HTMLInputElement | null>(null);
  const userRef = useRef<HTMLInputElement | null>(null);
  const passRef = useRef<HTMLInputElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Auto-focus server field on mount if not confirmed
    if (!confirmedServer) {
      serverRef.current?.focus();
    }
  }, [confirmedServer]);

  useEffect(() => {
    let cancelled = false;
    detectBackendServedWebUi().then((served) => {
      if (cancelled) return;
      setBackendServed(served);
      if (served) {
        const origin = window.location.origin;
        setServer(origin);
        setConfirmedServer(normalizeServerUrl(origin));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Prefill demo credentials when the demo server is selected.
    if (!confirmedServer) return;
    if (normalizeServerUrl(confirmedServer) === DEMO_SERVER_URL) {
      setUsername((u) => (u ? u : DEMO_USERNAME));
      setPassword((p) => (p ? p : DEMO_PASSWORD));
    }
  }, [confirmedServer]);

  useEffect(() => {
    if (!confirmedServer) {
      setServerStatus(null);
      setStatusError(false);
      return;
    }
    const normalized = normalizeServerUrl(confirmedServer);
    if (!normalized) {
      setServerStatus(null);
      return;
    }

    setStatusLoading(true);
    setStatusError(false);
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${normalized}/api/status`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          setServerStatus(data);
        } else {
          setServerStatus(null);
          setStatusError(true);
        }
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setServerStatus(null);
          setStatusError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setStatusLoading(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [confirmedServer]);

  useEffect(() => {
    if (serverStatus) {
      if (ssoAvailable && !basicAuthAvailable) {
        setUseSso(true);
      } else if (!ssoAvailable && basicAuthAvailable) {
        setUseSso(false);
      }
    }
  }, [serverStatus, ssoAvailable, basicAuthAvailable]);

  // Parse SSO redirect style: {server}/access_token=...&refresh_token=...
  useEffect(() => {
    try {
      const loc = window.location;
      const search = loc.search.startsWith("?")
        ? loc.search.substring(1)
        : loc.search;
      const path = loc.pathname.startsWith("/")
        ? loc.pathname.slice(1)
        : loc.pathname;
      const hash = loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash;

      // Priority order: query string (?access_token=...), then path style, then hash fragment.
      let candidate = "";
      if (/access_token=/.test(search)) candidate = search;
      else if (/access_token=/.test(path)) candidate = path;
      else if (/access_token=/.test(hash)) candidate = hash;
      if (!candidate) return; // no tokens present

      const params = new URLSearchParams(candidate.replace(/^[^?]*\?/, ""));
      const access = params.get("access_token") || "";
      const refresh = params.get("refresh_token") || undefined;
      if (!access) return;

      const base = window.location.origin; // assume same origin the user entered for SSO
      (async () => {
        try {
          await loginWithTokens(base, {
            access_token: access,
            refresh_token: refresh,
          });
          // Scrub sensitive tokens from URL: go to /login (or /library directly after navigation) without query/hash.
          const cleanUrl = base + "/login";
          window.history.replaceState({}, document.title, cleanUrl);
          navigate("/library", { replace: true });
        } catch {
          // ignore - context will show error
        }
      })();
    } catch {
      // swallow parsing errors silently
    }
  }, [loginWithTokens, navigate]);

  const handleContinue = (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    if (!server.trim()) return;
    const normalized = normalizeServerUrl(server);
    setServer(normalized);
    setConfirmedServer(normalized);
  };

  const handleChangeServer = () => {
    setConfirmedServer(null);
    setServerStatus(null);
  };

  const onSubmit = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    try {
      const normalized = normalizeServerUrl(confirmedServer || server);
      if (useSso) {
        window.location.href = `${normalized}/api/auth/oauth2/login`;
        return;
      }
      await loginBasic({ server: normalized, username, password });
      navigate("/library", { replace: true });
    } catch {
      // error handled in context
    }
  };

  const handleTrapKey: React.KeyboardEventHandler = (e) => {
    if (e.key !== "Tab") return;
    // Build current focusable list (skip disabled)
    const elems = [
      serverRef.current,
      userRef.current,
      passRef.current,
      submitRef.current,
    ].filter(
      (el): el is HTMLInputElement | HTMLButtonElement =>
        !!el &&
        (typeof (el as any).disabled === "boolean"
          ? !(el as any).disabled
          : true),
    );
    if (elems.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIndex = elems.findIndex((el) => el === active);
    const goingBack = e.shiftKey;
    if (goingBack) {
      // Shift+Tab on first -> go to last
      if (currentIndex === 0 || active == null) {
        e.preventDefault();
        elems[elems.length - 1]!.focus();
      }
    } else {
      // Tab on last -> go to first
      if (currentIndex === elems.length - 1) {
        e.preventDefault();
        elems[0]!.focus();
      }
    }
  };

  return (
    <form
      onSubmit={confirmedServer ? onSubmit : handleContinue}
      onKeyDown={handleTrapKey}
      className="grid w-full max-w-sm grid-cols-1 gap-6"
    >
      <div tabIndex={-1} aria-hidden="true">
        <Logo variant="text" className="w-full" height="h-full" />
      </div>
      <div className="space-y-3">
        <Heading tabIndex={-1}>Sign in to your account</Heading>
        <Text>
          Connect to your GameVault node, then enter with local auth or SSO.
        </Text>
      </div>

      {!confirmedServer && !backendServed && (
        <div className="grid grid-cols-1 gap-6 animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none">
          <Field>
            <Label>Server</Label>
            <Input
              type="text"
              name="server"
              required
              value={server}
              onChange={(e) => setServer(e.target.value)}
              // Only trim whitespace on blur; do NOT auto-inject protocol into the visible field
              onBlur={() => setServer((s) => s.trim())}
              autoComplete="url"
              ref={serverRef}
              tabIndex={1}
              autoFocus
            />
          </Field>
          <Button type="submit" className="w-full">
            Continue
          </Button>
        </div>
      )}

      {confirmedServer && (
        <div className="grid grid-cols-1 gap-6 animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none">
          <Field>
            <Label>Server</Label>
            <div data-slot="control" className="flex gap-2">
              <Input
                name="server_display"
                value={confirmedServer}
                disabled
                className="flex-1"
              />
              {!backendServed && (
                <Button
                  type="button"
                  outline
                  onClick={handleChangeServer}
                  className="shrink-0"
                >
                  Change
                </Button>
              )}
            </div>
          </Field>

          {statusLoading && <Text>Connecting to server...</Text>}

          {statusError && (
            <Text className="text-xs text-rose-400 -mt-4">
              Failed to connect to server. Please check the URL.
            </Text>
          )}

          {!statusLoading && !statusError && (
            <>
              {basicAuthAvailable && !useSso && (
                <Field>
                  <Label>Username or Email</Label>
                  <Input
                    name="username"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    ref={userRef}
                    tabIndex={2}
                  />
                </Field>
              )}
              {basicAuthAvailable && !useSso && (
                <Field>
                  <Label>Password</Label>
                  <Input
                    type="password"
                    name="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    ref={passRef}
                    tabIndex={3}
                  />
                </Field>
              )}
              {ssoAvailable && basicAuthAvailable && (
                <CheckboxField className="cursor-pointer select-none">
                  <Checkbox
                    id="login-sso"
                    name="useSso"
                    color="indigo"
                    className="cursor-pointer"
                    checked={useSso}
                    onChange={(checked: boolean) => setUseSso(!!checked)}
                  />
                  <Label htmlFor="login-sso" className="cursor-pointer">
                    Login with SSO
                  </Label>
                </CheckboxField>
              )}
              {noAuthAvailable && (
                <div
                  className="rounded-2xl bg-rose-500/10 px-3 py-2 text-sm text-rose-500"
                  role="alert"
                >
                  No authentication methods are currently available on this
                  server.
                </div>
              )}
              {error && (
                <div
                  className="-mt-2 rounded-2xl bg-red-500/10 px-3 py-2 text-sm text-red-500"
                  role="alert"
                >
                  {error}
                </div>
              )}
              {!noAuthAvailable && (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading}
                  tabIndex={4}
                  ref={submitRef}
                >
                  {loading
                    ? useSso
                      ? "Preparing SSO…"
                      : "Authenticating…"
                    : useSso
                      ? "Continue with SSO"
                      : "Login"}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <Text tabIndex={-1} aria-hidden="true">
        Don’t have an account? {""}
        <TextLink href="/register" tabIndex={-1} aria-hidden="true">
          <Strong>Sign up</Strong>
        </TextLink>
      </Text>
    </form>
  );
}
