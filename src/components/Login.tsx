import { useAuth } from "@/context/AuthContext";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import ThemeSwitch from "./ThemeSwitch";
import { Status } from "../api";

export function Login() {
  const { loginBasic, loginWithTokens, loading, error } = useAuth();
  const navigate = useNavigate();
  const [server, setServer] = useState(window.location.origin);
  const [confirmedServer, setConfirmedServer] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useSso, setUseSso] = useState(false);
  const [serverStatus, setServerStatus] = useState<Status | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(false);

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

  const normalizeServer = useCallback((raw: string) => {
    if (!raw) return raw;
    let s = raw.trim();
    // If user omitted protocol, assume https
    if (!/^https?:\/\//i.test(s)) {
      s = `https://${s}`;
    }
    // Remove trailing slashes
    s = s.replace(/\/+$/, "");
    return s;
  }, []);

  useEffect(() => {
    if (!confirmedServer) {
      setServerStatus(null);
      setStatusError(false);
      return;
    }
    const normalized = normalizeServer(confirmedServer);
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
  }, [confirmedServer, normalizeServer]);

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

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!server.trim()) return;
    let normalized = server.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    setServer(normalized);
    setConfirmedServer(normalized);
  };

  const handleChangeServer = () => {
    setConfirmedServer(null);
    setServerStatus(null);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const normalized = normalizeServer(confirmedServer || server);
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
      className="grid w-full max-w-sm grid-cols-1 gap-8"
    >
      <div tabIndex={-1} aria-hidden="true">
        <Logo variant="text" className="w-full" height="h-full" />
      </div>
      <Heading tabIndex={-1}>Sign in to your account</Heading>

      {!confirmedServer && (
        <>
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
        </>
      )}

      {confirmedServer && (
        <>
          <Field>
            <Label>Server</Label>
            <div data-slot="control" className="flex gap-2">
              <Input
                name="server_display"
                value={confirmedServer}
                disabled
                className="flex-1"
              />
              <Button
                type="button"
                onClick={handleChangeServer}
                className="shrink-0 bg-gray-200 text-gray-800 hover:bg-gray-300"
              >
                Change
              </Button>
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
                <div className="text-sm text-rose-500" role="alert">
                  No authentication methods are currently available on this server.
                </div>
              )}
              {error && (
                <div className="text-sm text-red-500 -mt-4" role="alert">
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
        </>
      )}

      <Text tabIndex={-1} aria-hidden="true">
        Don’t have an account? {""}
        <TextLink href="/register" tabIndex={-1} aria-hidden="true">
          <Strong>Sign up</Strong>
        </TextLink>
      </Text>
      <div tabIndex={-1} aria-hidden="true">
        <ThemeSwitch />
      </div>
    </form>
  );
}
