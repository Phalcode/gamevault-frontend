import { useAuth } from "@/context/AuthContext";
import { useRegistrationRequirements } from "@/hooks/useRegistrationRequirements";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import { useCallback, useEffect, useState } from "react";
import { applyTheme, getStoredTheme } from "@/utils/theme";

interface FormState {
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  birth_date?: string;
  password?: string;
  repeat_password?: string;
}

export function Register() {
  const { serverUrl } = useAuth();
  const [serverInput, setServerInput] = useState(window.location.origin);
  const [confirmedServer, setConfirmedServer] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const {
    loading: reqLoading,
    error: reqError,
    required,
    registrationEnabled,
    availableAuthenticationMethods,
  } = useRegistrationRequirements(confirmedServer || undefined);

  const basicAuthAvailable = availableAuthenticationMethods.includes("basic");
  const ssoAvailable = availableAuthenticationMethods.includes("sso");

  // Force device theme on register page; restore stored preference on leave
  useEffect(() => {
    const stored = getStoredTheme();
    applyTheme("system");
    return () => applyTheme(stored);
  }, []);

  const onInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value === "" ? undefined : value }));
    setTouched((t) => ({ ...t, [name]: true }));
    setMsg(null);
  };
  const onServerInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setServerInput(e.target.value);
    setMsg(null);
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverInput.trim()) return;
    let normalized = serverInput.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    setServerInput(normalized);
    setConfirmedServer(normalized);
    setMsg(null);
  };

  const handleChangeServer = () => {
    setConfirmedServer(null);
    setMsg(null);
    setSuccess(false);
  };

  const canSubmit = () => {
    if (!confirmedServer) return false;
    if (reqLoading) return false;
    if (reqError) return false;
    if (registrationEnabled === false) return false;
    if (!basicAuthAvailable) return false;
    const mandatory = Array.from(required);
    if (
      mandatory.includes("password") &&
      !mandatory.includes("repeat_password")
    )
      mandatory.push("repeat_password");
    for (const f of mandatory) {
      const val = (form as any)[f];
      if (typeof val !== "string" || !val.trim()) return false;
    }
    if ((form.password || "") !== (form.repeat_password || "")) return false;
    return true;
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit() || submitting) return;
      const chosenServer = confirmedServer;
      if (!chosenServer) {
        setMsg("Missing server URL");
        return;
      }
      setSubmitting(true);
      setMsg(null);
      setSuccess(false);
      try {
        let base = chosenServer.replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
        const normalizeOptional = (v?: string) =>
          typeof v === "string" && v.trim() ? v.trim() : null;
        const payload: any = {
          username: (form.username || "").trim(),
          email: normalizeOptional(form.email),
          first_name: normalizeOptional(form.first_name),
          last_name: normalizeOptional(form.last_name),
          birth_date: normalizeOptional(form.birth_date),
          password: form.password || "",
        };
        const res = await fetch(`${base}/api/auth/basic/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(
            `Register failed (${res.status}): ${txt || res.statusText}`,
          );
        }
        await res.json().catch(() => ({}));
        setSuccess(true);
        setMsg("Registration successful. You can now sign in.");
      } catch (err: any) {
        setMsg(err?.message || "Registration error");
      } finally {
        setSubmitting(false);
      }
    },
    [form, confirmedServer, submitting, canSubmit],
  );

  const isInvalid = (field: string) => {
    if (reqError || reqLoading || !confirmedServer) return false;
    const isReq =
      field === "repeat_password"
        ? required.has("password")
        : required.has(field);
    if (!isReq) return false;
    const val = (form as any)[field];
    return touched[field] && (typeof val !== "string" || !val.trim());
  };

  return (
    <form
      onSubmit={confirmedServer ? handleSubmit : handleContinue}
      className="grid w-full max-w-sm grid-cols-1 gap-6"
    >
      <Logo variant="text" className="w-full" height="h-full" />
      <div className="space-y-3">
        <Heading>Create your account</Heading>
        <Text>
          Point at your server, confirm requirements, then create a local
          launcher account.
        </Text>
      </div>

      {!confirmedServer && (
        <>
          <Field>
            <Label>
              Server URL{" "}
              <span className="text-rose-400" aria-hidden>
                *
              </span>
            </Label>
            <Input
              name="server"
              placeholder="example.com or https://example.com"
              value={serverInput}
              onChange={onServerInput}
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
            <Label>Server URL</Label>
            <div data-slot="control" className="flex gap-2">
              <Input
                name="server_display"
                value={confirmedServer}
                disabled
                className="flex-1"
              />
              <Button
                type="button"
                outline
                onClick={handleChangeServer}
                className="shrink-0"
              >
                Change
              </Button>
            </div>
          </Field>

          {reqLoading && (
            <div className="flex items-center gap-2 text-gv-muted">
              <svg className="h-4 w-4 motion-safe:animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <Text>Connecting to server...</Text>
            </div>
          )}

          {reqError && (
            <Text className="text-xs text-rose-400 -mt-4">
              Failed to connect to server. Please check the URL.
            </Text>
          )}

          {!reqLoading && !reqError && registrationEnabled === false && (
            <Text className="text-xs text-rose-400 -mt-4">
              Registration is currently disabled on this server.
            </Text>
          )}

          {!reqLoading && !reqError && registrationEnabled !== false && (
            <>
              {!basicAuthAvailable && (
                <Text className="text-xs text-rose-400 -mt-4" role="alert">
                  {ssoAvailable
                    ? "Registration via username and password is disabled on this server. Please sign in via SSO. Your account should be created automatically."
                    : "Registration is not available."}
                </Text>
              )}
              {basicAuthAvailable && (
                <>
                  <Field>
                    <Label>
                      Username{" "}
                      {!reqLoading && required.has("username") && (
                        <span className="text-rose-400" aria-hidden>
                          *
                        </span>
                      )}
                    </Label>
                    <Input
                      aria-required
                      name="username"
                      autoComplete="username"
                      value={form.username ?? ""}
                      onChange={onInput}
                      className={
                        isInvalid("username")
                          ? "ring-1 ring-rose-500"
                          : undefined
                      }
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-4">
                    <Field>
                      <Label>
                        First name{" "}
                        {!reqLoading && required.has("first_name") && (
                          <span className="text-rose-400" aria-hidden>
                            *
                          </span>
                        )}
                      </Label>
                      <Input
                        aria-required
                        name="first_name"
                        autoComplete="given-name"
                        value={form.first_name ?? ""}
                        onChange={onInput}
                        className={
                          isInvalid("first_name")
                            ? "ring-1 ring-rose-500"
                            : undefined
                        }
                      />
                    </Field>
                    <Field>
                      <Label>
                        Last name{" "}
                        {!reqLoading && required.has("last_name") && (
                          <span className="text-rose-400" aria-hidden>
                            *
                          </span>
                        )}
                      </Label>
                      <Input
                        aria-required
                        name="last_name"
                        autoComplete="family-name"
                        value={form.last_name ?? ""}
                        onChange={onInput}
                        className={
                          isInvalid("last_name")
                            ? "ring-1 ring-rose-500"
                            : undefined
                        }
                      />
                    </Field>
                  </div>
                  <Field>
                    <Label>
                      Email{" "}
                      {!reqLoading && required.has("email") && (
                        <span className="text-rose-400" aria-hidden>
                          *
                        </span>
                      )}
                    </Label>
                    <Input
                      aria-required
                      type="email"
                      name="email"
                      autoComplete="email"
                      value={form.email ?? ""}
                      onChange={onInput}
                      className={
                        isInvalid("email") ? "ring-1 ring-rose-500" : undefined
                      }
                    />
                  </Field>
                  <Field>
                    <Label>
                      Birth date{" "}
                      {!reqLoading && required.has("birth_date") && (
                        <span className="text-rose-400" aria-hidden>
                          *
                        </span>
                      )}
                    </Label>
                    <Input
                      aria-required={
                        required.has("birth_date") ? true : undefined
                      }
                      type="date"
                      name="birth_date"
                      value={form.birth_date ?? ""}
                      onChange={onInput}
                      className={
                        isInvalid("birth_date")
                          ? "ring-1 ring-rose-500"
                          : undefined
                      }
                    />
                  </Field>
                  <Field>
                    <Label>
                      Password{" "}
                      {!reqLoading && required.has("password") && (
                        <span className="text-rose-400" aria-hidden>
                          *
                        </span>
                      )}
                    </Label>
                    <Input
                      aria-required
                      type="password"
                      name="password"
                      autoComplete="new-password"
                      value={form.password ?? ""}
                      onChange={onInput}
                      className={
                        isInvalid("password")
                          ? "ring-1 ring-rose-500"
                          : undefined
                      }
                    />
                  </Field>
                  <Field>
                    <Label>
                      Repeat password{" "}
                      {!reqLoading && required.has("password") && (
                        <span className="text-rose-400" aria-hidden>
                          *
                        </span>
                      )}
                    </Label>
                    <Input
                      aria-required
                      type="password"
                      name="repeat_password"
                      autoComplete="new-password"
                      value={form.repeat_password ?? ""}
                      onChange={onInput}
                      className={
                        isInvalid("repeat_password") ||
                        (touched.repeat_password &&
                          form.password &&
                          form.repeat_password &&
                          form.password !== form.repeat_password)
                          ? "ring-1 ring-rose-500"
                          : undefined
                      }
                    />
                  </Field>
                  {form.password &&
                    form.repeat_password &&
                    form.password !== form.repeat_password && (
                      <Text className="text-xs text-rose-400 -mt-6">
                        Passwords do not match
                      </Text>
                    )}
                </>
              )}
              {msg && (
                <Text
                  className={`text-xs ${success ? "text-emerald-400" : "text-rose-400"} -mt-4`}
                >
                  {msg}
                </Text>
              )}
              {!success && basicAuthAvailable && (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!canSubmit() || submitting}
                >
                  {submitting ? "Creating account…" : "Create account"}
                </Button>
              )}
            </>
          )}
        </>
      )}
      <Text>
        Already have an account? {""}
        <TextLink href="/">
          <Strong>Sign in</Strong>
        </TextLink>
      </Text>
    </form>
  );
}
