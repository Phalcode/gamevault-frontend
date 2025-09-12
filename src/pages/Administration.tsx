import { PencilSquareIcon, TrashIcon } from "@heroicons/react/16/solid";
import Card from "../components/Card";
import { Avatar } from "../components/tailwind/avatar";
import { Button } from "../components/tailwind/button";
import {
  DescriptionDetails,
  DescriptionList,
  DescriptionTerm,
} from "../components/tailwind/description-list";
import { Divider } from "../components/tailwind/divider";
import { Heading } from "../components/tailwind/heading";
import { Link } from "../components/tailwind/link";
import {
  Listbox,
  ListboxLabel,
  ListboxOption,
} from "../components/tailwind/listbox";
import { Switch } from "../components/tailwind/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/tailwind/table";
("@heroicons/react/16/solid");

const serverVersion = "15.0.3";
const users = [
  {
    handle: "jdoe",
    name: "John Doe",
    email: "jdoe@example.com",
    avatarUrl: "https://i.pravatar.cc/150?img=1",
    role: "guest",
    activated: true,
  },
  {
    handle: "asmith",
    name: "Alice Smith",
    email: "asmith@example.com",
    avatarUrl: "https://i.pravatar.cc/150?img=2",
    role: "editor",
    activated: false,
  },
  {
    handle: "bchan",
    name: "Brian Chan",
    email: "bchan@example.com",
    avatarUrl: "https://i.pravatar.cc/150?img=3",
    role: "user",
    activated: true,
  },
  {
    handle: "mgarcia",
    name: "Maria Garcia",
    email: "mgarcia@example.com",
    avatarUrl: "https://i.pravatar.cc/150?img=4",
    role: "admin",
    activated: false,
  },
  {
    handle: "kwong",
    name: "Kevin Wong",
    email: "kwong@example.com",
    avatarUrl: "https://i.pravatar.cc/150?img=5",
    role: "user",
    activated: true,
  },
];

export default function Administration() {
  return (
    <div className="flex flex-col h-full">
      <Heading>Administration</Heading>
      <Divider />
      <Card title="Server Information">
        <DescriptionList>
          <DescriptionTerm>Address</DescriptionTerm>
          <DescriptionDetails>
            https://gamevault.alfagun74.de (Healthy)
          </DescriptionDetails>

          <DescriptionTerm>Version</DescriptionTerm>
          <DescriptionDetails>
            <Link
              href={`https://github.com/Phalcode/gamevault-backend/releases/tag/${serverVersion}`}
              target="_blank"
            >
              {serverVersion}
            </Link>
          </DescriptionDetails>

          <DescriptionTerm>Users</DescriptionTerm>
          <DescriptionDetails>4</DescriptionDetails>
          <DescriptionTerm>Games</DescriptionTerm>
          <DescriptionDetails>421</DescriptionDetails>
          <DescriptionTerm>Progresses</DescriptionTerm>
          <DescriptionDetails>62</DescriptionDetails>
        </DescriptionList>
      </Card>

      <Card title="Users">
        <Table className="[--gutter:--spacing(6)] sm:[--gutter:--spacing(8)]">
          <TableHead>
            <TableRow>
              <TableHeader>Name</TableHeader>
              <TableHeader>Activated</TableHeader>
              <TableHeader>Role</TableHeader>
              <TableHeader>Action</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.handle}>
                <TableCell>
                  <div className="flex items-center gap-4">
                    <Avatar src={user.avatarUrl} className="size-12" />
                    <div>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-zinc-500">
                        <a href="#" className="hover:text-zinc-700">
                          {user.email}
                        </a>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Switch
                    name="activated"
                    color="green"
                    checked={user.activated}
                  />
                </TableCell>
                <TableCell className="text-zinc-500">
                  <Listbox name="role" defaultValue="user" value={user.role}>
                    <ListboxOption value="guest">
                      <ListboxLabel>Guest</ListboxLabel>
                    </ListboxOption>
                    <ListboxOption value="user">
                      <ListboxLabel>User</ListboxLabel>
                    </ListboxOption>
                    <ListboxOption value="editor">
                      <ListboxLabel>Editor</ListboxLabel>
                    </ListboxOption>
                    <ListboxOption value="admin">
                      <ListboxLabel>Admin</ListboxLabel>
                    </ListboxOption>
                  </Listbox>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button>
                      <PencilSquareIcon /> <span className="sr-only">Edit</span>
                    </Button>
                    <Button>
                      <TrashIcon /> <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
