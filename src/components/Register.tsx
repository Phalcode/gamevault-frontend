import { Logo } from "@components/Logo";
import { Button } from "@tw/button";
import { Field, Label } from "@tw/fieldset";
import { Heading } from "@tw/heading";
import { Input } from "@tw/input";
import { Strong, Text, TextLink } from "@tw/text";

export function Register() {
  return (
    <form
      action="#"
      method="POST"
      className="grid w-full max-w-sm grid-cols-1 gap-8"
    >
      <Logo variant="text" className="w-full" height="h-full" />

      <Heading>Create your account</Heading>
      <Field>
        <Label>Username</Label>
        <Input name="username" autoComplete="username" />
      </Field>
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-4">
        <Field>
          <Label>First name</Label>
          <Input name="first_name" autoComplete="given-name" />
        </Field>
        <Field>
          <Label>Last name</Label>
          <Input name="last_name" autoComplete="family-name" />
        </Field>
      </div>
      <Field>
        <Label>Email</Label>
        <Input type="email" name="email" autoComplete="email" />
      </Field>
      <Field>
        <Label>Password</Label>
        <Input type="password" name="password" autoComplete="new-password" />
      </Field>
      <Button type="submit" className="w-full" href="/library">
        Create account
      </Button>
      <Text>
        Already have an account?{" "}
        <TextLink href="/">
          <Strong>Sign in</Strong>
        </TextLink>
      </Text>
    </form>
  );
}
