import { useState, useCallback } from "react";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import { useAuth } from "@/context/AuthContext";

interface FormState {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  birth_date: string;
  password: string;
  repeat_password: string;
}

export function Register() {
  const { serverUrl } = useAuth();
  const [form, setForm] = useState<FormState>({
    username: "",
    first_name: "",
    last_name: "",
    email: "",
    birth_date: "",
    password: "",
    repeat_password: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const onInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setTouched(t => ({ ...t, [name]: true }));
    setMsg(null);
  };

  const canSubmit = () => {
    const required = ["username", "first_name", "last_name", "email", "password", "repeat_password"]; // birth_date optional
    for (const r of required) {
      if (!(form as any)[r] || !(form as any)[r].toString().trim()) return false;
    }
    if (form.password !== form.repeat_password) return false;
    return true;
  };

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
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
      const payload: any = {
        Username: form.username.trim(),
        Password: form.password,
        EMail: form.email.trim(),
        FirstName: form.first_name.trim(),
        LastName: form.last_name.trim(),
        BirthDate: form.birth_date || null,
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        birth_date: form.birth_date || null,
        password: form.password,
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
        throw new Error(`Register failed (${res.status}): ${txt || res.statusText}`);
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
  }, [form, serverUrl, submitting]);

  const requiredFields = ["username","first_name","last_name","email","password","repeat_password"]; // birth_date optional
  const isInvalid = (field: string) => {
    if (!requiredFields.includes(field)) return false;
    return touched[field] && !(form as any)[field]?.toString().trim();
  };

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-sm grid-cols-1 gap-8">
      <Logo variant="text" className="w-full" height="h-full" />
      <Heading>Create your account</Heading>
      <Field>
        <Label>Username <span className="text-rose-400" aria-hidden>*</span></Label>
        <Input aria-required name="username" autoComplete="username" value={form.username} onChange={onInput} className={isInvalid('username') ? 'ring-1 ring-rose-500' : undefined} />
      </Field>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-4">
        <Field>
          <Label>First name <span className="text-rose-400" aria-hidden>*</span></Label>
          <Input aria-required name="first_name" autoComplete="given-name" value={form.first_name} onChange={onInput} className={isInvalid('first_name') ? 'ring-1 ring-rose-500' : undefined} />
        </Field>
        <Field>
          <Label>Last name <span className="text-rose-400" aria-hidden>*</span></Label>
          <Input aria-required name="last_name" autoComplete="family-name" value={form.last_name} onChange={onInput} className={isInvalid('last_name') ? 'ring-1 ring-rose-500' : undefined} />
        </Field>
      </div>
      <Field>
        <Label>Email <span className="text-rose-400" aria-hidden>*</span></Label>
        <Input aria-required type="email" name="email" autoComplete="email" value={form.email} onChange={onInput} className={isInvalid('email') ? 'ring-1 ring-rose-500' : undefined} />
      </Field>
      <Field>
        <Label>Birth date</Label>
        <Input type="date" name="birth_date" value={form.birth_date} onChange={onInput} />
      </Field>
      <Field>
        <Label>Password <span className="text-rose-400" aria-hidden>*</span></Label>
        <Input aria-required type="password" name="password" autoComplete="new-password" value={form.password} onChange={onInput} className={isInvalid('password') ? 'ring-1 ring-rose-500' : undefined} />
      </Field>
      <Field>
        <Label>Repeat password <span className="text-rose-400" aria-hidden>*</span></Label>
        <Input aria-required type="password" name="repeat_password" autoComplete="new-password" value={form.repeat_password} onChange={onInput} className={isInvalid('repeat_password') || (touched.repeat_password && form.password && form.repeat_password && form.password !== form.repeat_password) ? 'ring-1 ring-rose-500' : undefined} />
      </Field>
      {form.password && form.repeat_password && form.password !== form.repeat_password && (
        <Text className="text-xs text-rose-400 -mt-6">Passwords do not match</Text>
      )}
      {msg && (
        <Text className={`text-xs ${success ? 'text-emerald-400' : 'text-rose-400'} -mt-4`}>{msg}</Text>
      )}
      {!msg && !canSubmit() && (
        <Text className="text-xs text-fg-muted -mt-4">Fill required fields and matching passwords.</Text>
      )}
      <Button type="submit" className="w-full" disabled={!canSubmit() || submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </Button>
      <Text>
        Already have an account? {""}
        <TextLink href="/">
          <Strong>Sign in</Strong>
        </TextLink>
      </Text>
    </form>
  );
}
