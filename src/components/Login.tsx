import { Button } from "./tailwind/button";
import { Checkbox, CheckboxField } from "./tailwind/checkbox";
import { Field, Label } from "./tailwind/fieldset";
import { Heading } from "./tailwind/heading";
import { Input } from "./tailwind/input";
import { Strong, Text, TextLink } from "./tailwind/text";
import { Logo } from "./Logo";

export function Login() {
  return (
    <form
      action="#"
      method="POST"
      className="grid w-full max-w-sm grid-cols-1 gap-8"
    >
      <Logo />
      <Heading>Sign in to your account</Heading>
      <Field>
        <Label>Email</Label>
        <Input type="email" name="email" />
      </Field>
      <Field>
        <Label>Password</Label>
        <Input type="password" name="password" />
      </Field>
      <div className="flex items-center justify-between">
        <CheckboxField>
          <Checkbox name="remember" />
          <Label>Remember me</Label>
        </CheckboxField>
      </div>
      <Button type="submit" className="w-full" href="/library">
        Login
      </Button>
      <Text>
        Don’t have an account?{" "}
        <TextLink href="/register">
          <Strong>Sign up</Strong>
        </TextLink>
      </Text>
    </form>
  );
}
