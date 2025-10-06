import { Button } from "@/components/tailwind/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Field, Label } from "@/components/tailwind/fieldset";
import { Input } from "@/components/tailwind/input";
import { Text } from "@/components/tailwind/text";
import { useAuth } from "@/context/AuthContext";
import { useRegistrationRequirements } from "@/hooks/useRegistrationRequirements";
import { useCallback, useState } from "react";
import { GamevaultUser } from "../../api";

interface Props {
  onClose: () => void;
  onRegistered: (u: GamevaultUser) => void;
}

export function RegisterUserModal({ onClose, onRegistered }: Props) {
  const { serverUrl, authFetch } = useAuth();
  const {
    loading: reqLoading,
    error: reqError,
    required,
  } = useRegistrationRequirements(); // ignore registrationEnabled per spec
  const [form, setForm] = useState<{
    username?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    birth_date?: string;
    password?: string;
    repeat_password?: string;
  }>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value === "" ? undefined : value }));
    setTouched((t) => ({ ...t, [name]: true }));
    setMsg(null);
  };

  const canSubmit = () => {
    if (reqLoading || reqError) return false; // require successful requirements load
    if (!serverUrl) return false;
    const mandatory = Array.from(required);
    if (
      mandatory.includes("password") &&
      !mandatory.includes("repeat_password")
    )
      mandatory.push("repeat_password");
    for (const f of mandatory) {
      const v = (form as any)[f];
      if (typeof v !== "string" || !v.trim()) return false;
    }
    if ((form.password || "") !== (form.repeat_password || "")) return false;
    return true;
  };

  const isInvalid = (field: string) => {
    if (reqLoading || reqError) return false;
    const isReq =
      field === "repeat_password"
        ? required.has("password")
        : required.has(field);
    if (!isReq) return false;
    const val = (form as any)[field];
    return touched[field] && (typeof val !== "string" || !val.trim());
  };

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSubmit() || submitting) return;
      if (!serverUrl) {
        setMsg("Missing server URL");
        return;
      }
      setSubmitting(true);
      setMsg(null);
      setSuccess(false);
      try {
        const base = serverUrl.replace(/\/+$/, "");
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
        const res = await authFetch(`${base}/api/auth/basic/register`, {
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
        const createdUser: GamevaultUser = await res.json();
        onRegistered(createdUser);
        setSuccess(true);
        setMsg("User registered successfully");
        setTimeout(() => onClose(), 800);
      } catch (e: any) {
        setMsg(e?.message || "Registration error");
      } finally {
        setSubmitting(false);
      }
    },
    [form, serverUrl, submitting, authFetch, onRegistered, onClose],
  );

  return (
    <Dialog open onClose={onClose} size="lg" className="">
      <DialogTitle className="flex items-center justify-between gap-4">
        <span>Register new user</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300/40 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
          disabled={submitting}
          aria-label="Close"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
          >
            <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
            <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
          </svg>
        </button>
      </DialogTitle>
      <DialogBody className="pt-2">
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-6 sm:grid-cols-2"
        >
          <Field className="sm:col-span-2">
            <Label>
              Username{" "}
              {!reqLoading && !reqError && required.has("username") && (
                <span className="text-rose-400" aria-hidden>
                  *
                </span>
              )}
            </Label>
            <Input
              name="username"
              autoComplete="username"
              value={form.username ?? ""}
              onChange={onInput}
              className={
                isInvalid("username") ? "ring-1 ring-rose-500" : undefined
              }
            />
          </Field>
          <Field>
            <Label>
              First name{" "}
              {!reqLoading && !reqError && required.has("first_name") && (
                <span className="text-rose-400" aria-hidden>
                  *
                </span>
              )}
            </Label>
            <Input
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
              {!reqLoading && !reqError && required.has("last_name") && (
                <span className="text-rose-400" aria-hidden>
                  *
                </span>
              )}
            </Label>
            <Input
              name="last_name"
              autoComplete="family-name"
              value={form.last_name ?? ""}
              onChange={onInput}
              className={
                isInvalid("last_name") ? "ring-1 ring-rose-500" : undefined
              }
            />
          </Field>
          <Field className="sm:col-span-2">
            <Label>
              Email{" "}
              {!reqLoading && !reqError && required.has("email") && (
                <span className="text-rose-400" aria-hidden>
                  *
                </span>
              )}
            </Label>
            <Input
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
              {!reqLoading && !reqError && required.has("birth_date") && (
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
              {!reqLoading && !reqError && required.has("password") && (
                <span className="text-rose-400" aria-hidden>
                  *
                </span>
              )}
            </Label>
            <Input
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
              {!reqLoading && !reqError && required.has("password") && (
                <span className="text-rose-400" aria-hidden>
                  *
                </span>
              )}
            </Label>
            <Input
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
          <div className="sm:col-span-2 flex flex-col gap-2 -mt-2">
            {reqLoading && (
              <Text className="text-xs text-fg-muted">
                Loading registration requirements…
              </Text>
            )}
            {reqError && !reqLoading && (
              <Text className="text-xs text-rose-400">
                Failed to load registration requirements. Cannot submit.
              </Text>
            )}
            {form.password &&
              form.repeat_password &&
              form.password !== form.repeat_password && (
                <Text className="text-xs text-rose-400">
                  Passwords do not match
                </Text>
              )}
            {msg && (
              <Text
                className={`text-xs ${success ? "text-emerald-400" : "text-rose-400"}`}
              >
                {msg}
              </Text>
            )}
          </div>
          <DialogActions className="sm:col-span-2 mt-2">
            <Button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="bg-transparent border border-zinc-300/50 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit() || submitting}>
              {submitting ? "Registering…" : "Register"}
            </Button>
          </DialogActions>
        </form>
      </DialogBody>
    </Dialog>
  );
}
// Removed legacy inline styles in favor of shared tailwind components.
