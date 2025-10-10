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
import { RegisterUserDtoFromJSON } from "../api";

export function Login() {
  const { loginBasic, loginWithTokens, loading, error } = useAuth();
  const navigate = useNavigate();
  const [server, setServer] = useState(window.location.origin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useSso, setUseSso] = useState(false);

  // Refs for focus trap
  const serverRef = useRef<HTMLInputElement | null>(null);
  const userRef = useRef<HTMLInputElement | null>(null);
  const passRef = useRef<HTMLInputElement | null>(null);
  const submitRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Auto-focus server field on mount
    serverRef.current?.focus();
  }, []);

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

  // Parse SSO redirect style: {server}/access_token=...&refresh_token=...
  useEffect(() => {
    // Detect tokens embedded after origin (no question mark) e.g. https://srv/access_token=XXX&refresh_token=YYY
    // Or possibly inside hash.
    try {
      const loc = window.location;
      const path = loc.pathname.startsWith("/")
        ? loc.pathname.slice(1)
        : loc.pathname;
      const hash = loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash;
      const candidate = path.includes("access_token=") ? path : hash;
      if (!candidate) return;
      if (!/access_token=/.test(candidate)) return;
      // Interpret as key=value pairs separated by & possibly with leading segment (e.g., access_token=...&refresh_token=...)
      const pairs = candidate.split("&").filter(Boolean);
      const data: Record<string, string> = {};
      for (const p of pairs) {
        const eq = p.indexOf("=");
        if (eq === -1) continue;
        const k = decodeURIComponent(p.slice(0, eq));
        const v = decodeURIComponent(p.slice(eq + 1));
        data[k] = v;
      }
      if (!data.access_token) return;
      // Determine server base: remove the trailing candidate part from URL if it's at pathname
      const base = window.location.origin;
      (async () => {
        try {
          await loginWithTokens(base, {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
          });
          // Clean URL (remove tokens) then navigate
          window.history.replaceState({}, document.title, base + "/login");
          navigate("/library", { replace: true });
        } catch {
          // ignore - error shown via context
        }
      })();
    } catch {
      // ignore parsing errors
    }
  }, [loginWithTokens, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const normalized = normalizeServer(server);
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
      onSubmit={onSubmit}
      onKeyDown={handleTrapKey}
      className="grid w-full max-w-sm grid-cols-1 gap-8"
    >
      <div tabIndex={-1} aria-hidden="true">
        <Logo variant="text" className="w-full" height="h-full" />
      </div>
      <Heading tabIndex={-1}>Sign in to your account</Heading>
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
        />
      </Field>
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
          disabled={useSso}
        />
      </Field>
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
          disabled={useSso}
        />
      </Field>
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
      {error && (
        <div className="text-sm text-red-500 -mt-4" role="alert">
          {error}
        </div>
      )}
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
