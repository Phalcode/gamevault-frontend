import { useAuth } from "@/context/AuthContext";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import { FormEvent, useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import ThemeSwitch from "./ThemeSwitch";

export function Login() {
  const { loginBasic, loading, error } = useAuth();
  const navigate = useNavigate();
  const [server, setServer] = useState(window.location.origin);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const normalized = normalizeServer(server);
      await loginBasic({ server: normalized, username, password });
      if (!remember) {
        // If user disabled remember, clear stored refresh token
        localStorage.removeItem("app_refresh_token");
      }
      navigate("/library", { replace: true });
    } catch {
      // error handled in context
    }
  };

  const handleTrapKey: React.KeyboardEventHandler = (e) => {
    if (e.key !== 'Tab') return;
    // Build current focusable list (skip disabled)
    const elems = [serverRef.current, userRef.current, passRef.current, submitRef.current]
      .filter((el): el is (HTMLInputElement | HTMLButtonElement) => !!el && (typeof (el as any).disabled === 'boolean' ? !(el as any).disabled : true));
    if (elems.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const currentIndex = elems.findIndex(el => el === active);
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
        />
      </Field>
      <div className="flex items-center justify-between hidden">
        <CheckboxField>
          <Checkbox
            name="remember"
            checked={remember}
            onChange={(ev: any) => {
              const checked = (ev?.target as HTMLInputElement | undefined)
                ?.checked;
              if (typeof checked === "boolean") setRemember(checked);
            }}
          />
          <Label>Remember me</Label>
        </CheckboxField>
      </div>
      {error && (
        <div className="text-sm text-red-500 -mt-4" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading} tabIndex={4} ref={submitRef}>
        {loading ? "Authenticating…" : "Login"}
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
