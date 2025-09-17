import { useAuth } from "@/context/AuthContext";
import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Checkbox, CheckboxField } from "@tw/checkbox";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import ThemeSwitch from "./ThemeSwitch";

export function Login() {
  const { loginBasic, loading, error } = useAuth();
  const navigate = useNavigate();
  const [server, setServer] = useState("https://gamevault.alfagun74.de");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await loginBasic({ server, username, password });
      if (!remember) {
        // If user disabled remember, clear stored refresh token
        localStorage.removeItem("app_refresh_token");
      }
      navigate("/library", { replace: true });
    } catch {
      // error handled in context
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid w-full max-w-sm grid-cols-1 gap-8"
    >
      <Logo variant="text" className="w-full" height="h-full" />
      <Heading>Sign in to your account</Heading>
      <Field>
        <Label>Server</Label>
        <Input
          type="url"
          name="server"
          required
          value={server}
          onChange={(e) => setServer(e.target.value)}
          autoComplete="url"
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
        />
      </Field>
      <div className="flex items-center justify-between">
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
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Authenticating…" : "Login"}
      </Button>
      <Text>
        Don’t have an account? {""}
        <TextLink href="/register">
          <Strong>Sign up</Strong>
        </TextLink>
      </Text>
      <ThemeSwitch />
    </form>
  );
}
