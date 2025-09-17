import { useAuth } from "@/context/AuthContext";
import { useRegistrationRequirements } from "@/hooks/useRegistrationRequirements";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import { useCallback, useState } from "react";
import ThemeSwitch from "./ThemeSwitch";

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
  const [serverInput, setServerInput] = useState("");
  const [form, setForm] = useState<FormState>({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const normalizedServerInput = (() => {
    const raw = serverInput.trim();
    if (!raw) return "";
    // Add protocol if missing for display fetch usage; do not mutate user visible value.
    if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
    return raw;
  })();
  const {
    loading: reqLoading,
    error: reqError,
    required,
    registrationEnabled,
  } = useRegistrationRequirements(
    serverInput.trim() ? serverInput.trim() : undefined,
  );

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

  const canSubmit = () => {
    if (!serverInput.trim()) return false; // need server first
    if (reqLoading) return false; // must wait
    if (reqError) return false; // do not allow defaults when fetch failed
    if (registrationEnabled === false) return false; // disabled by server
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
      const chosenServer = serverInput.trim() || serverUrl;
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
        // we don't strictly need the response, but we can parse for messaging
        await res.json().catch(() => ({}));
        setSuccess(true);
        setMsg("Registration successful. You can now sign in.");
      } catch (err: any) {
        setMsg(err?.message || "Registration error");
      } finally {
        setSubmitting(false);
      }
    },
    [form, serverInput, serverUrl, submitting],
  );

  const isInvalid = (field: string) => {
    if (reqError || reqLoading || !serverInput.trim()) return false; // don't validate until requirements loaded
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
      onSubmit={handleSubmit}
      className="grid w-full max-w-sm grid-cols-1 gap-8"
    >
      <Logo variant="text" className="w-full" height="h-full" />
      <Heading>Create your account</Heading>
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
          className={
            !serverInput.trim() && touched["server"]
              ? "ring-1 ring-rose-500"
              : undefined
          }
        />
      </Field>
      {!serverInput.trim() && (
        <Text className="text-xs text-fg-muted -mt-4">
          Enter a server URL to continue with registration.
        </Text>
      )}
      {serverInput.trim() && registrationEnabled === false && (
        <Text className="text-xs text-rose-400 -mt-4">
          Registration is currently disabled on this server.
        </Text>
      )}
      {serverInput.trim() && reqError && !reqLoading && (
        <Text className="text-xs text-rose-400 -mt-4">
          Failed to load registration requirements. Cannot proceed.
        </Text>
      )}
      {serverInput.trim() &&
        !reqLoading &&
        registrationEnabled !== false &&
        !reqError && (
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
                  isInvalid("username") ? "ring-1 ring-rose-500" : undefined
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
                    isInvalid("first_name") ? "ring-1 ring-rose-500" : undefined
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
                    isInvalid("last_name") ? "ring-1 ring-rose-500" : undefined
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
                aria-required={required.has("birth_date") ? true : undefined}
                type="date"
                name="birth_date"
                value={form.birth_date ?? ""}
                onChange={onInput}
                className={
                  isInvalid("birth_date") ? "ring-1 ring-rose-500" : undefined
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
                  isInvalid("password") ? "ring-1 ring-rose-500" : undefined
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
            {/* Requirements fully loaded; no intermediate loading state UI since fields are hidden until ready */}
            {form.password &&
              form.repeat_password &&
              form.password !== form.repeat_password && (
                <Text className="text-xs text-rose-400 -mt-6">
                  Passwords do not match
                </Text>
              )}
            {msg && (
              <Text
                className={`text-xs ${success ? "text-emerald-400" : "text-rose-400"} -mt-4`}
              >
                {msg}
              </Text>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={!canSubmit() || submitting}
            >
              {submitting ? "Creating account…" : "Create account"}
            </Button>
          </>
        )}
      <Text>
        Already have an account? {""}
        <TextLink href="/sfsf">
          <Strong>Sign in</Strong>
        </TextLink>
      </Text>
      <ThemeSwitch />
    </form>
  );
}
