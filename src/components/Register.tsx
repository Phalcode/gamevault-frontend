import { Logo } from "./Logo";
import { Button } from "./tailwind/button";
import { Checkbox, CheckboxField } from "./tailwind/checkbox";
import { Field, Label } from "./tailwind/fieldset";
import { Heading } from "./tailwind/heading";
import { Input } from "./tailwind/input";
import { Select } from "./tailwind/select";
import { Strong, Text, TextLink } from "./tailwind/text";

export function Register() {
  return (
    <form
      action="#"
      method="POST"
      className="grid w-full max-w-sm grid-cols-1 gap-8"
    >
      <Logo />
      <Heading>Create your account</Heading>
      <Field>
        <Label>Email</Label>
        <Input type="email" name="email" />
      </Field>
      <Field>
        <Label>Full name</Label>
        <Input name="name" />
      </Field>
      <Field>
        <Label>Password</Label>
        <Input type="password" name="password" autoComplete="new-password" />
      </Field>
      <Field>
        <Label>Country</Label>
        <Select name="country">
          <option>Canada</option>
          <option>Mexico</option>
          <option>United States</option>
        </Select>
      </Field>
      <CheckboxField>
        <Checkbox name="remember" />
        <Label>Get emails about product updates and news.</Label>
      </CheckboxField>
      <Button type="submit" className="w-full">
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
