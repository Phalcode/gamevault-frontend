import { Divider } from "../components/tailwind/divider";
import { Heading, Subheading } from "../components/tailwind/heading";

export default function Administration() {
  return (
    <div className="flex flex-col h-full">
      <Heading>Administration</Heading>
      <Divider />
      <Subheading level={2}>General Settings and Information</Subheading>
      <Divider />
      <Subheading level={2}>Users</Subheading>
    </div>
  );
}
