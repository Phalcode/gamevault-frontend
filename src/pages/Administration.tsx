import { AuthMediaAvatar } from "@/components/AuthMediaAvatar";
import { useAuth } from "@/context/AuthContext";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useServerStatus } from "@/hooks/useServerStatus";
import { PermissionRole, PermissionRoleLabel } from "@/types/api";
import {
  ArrowPathIcon,
  PencilSquareIcon,
  TrashIcon,
  UserPlusIcon,
} from "@heroicons/react/16/solid";
import { Button } from "@tw/button";
import {
  DescriptionDetails,
  DescriptionList,
  DescriptionTerm,
} from "@tw/description-list";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Link } from "@tw/link";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { Switch } from "@tw/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tw/table";
import { useMemo, useState } from "react";
import Card from "../components/Card";
// Legacy modals (inline styles) brought back from old-src for now
import { RegisterUserModalOld } from "@/components/admin/RegisterUserModalOld";
import { UserEditorModalOld } from "@/components/admin/UserEditorModalOld";

export default function Administration() {
  const {
    users,
    loading,
    error,
    toggleActivated,
    updateUserRole,
    deleteUser,
    recoverUser,
    opBusy,
    updateUser,
    setUsers,
  } = useAdminUsers();
  const { serverUrl } = useAuth();
  const { info } = useServerStatus();
  const version = info?.version;

  // State: show deleted users toggle
  const [showDeleted, setShowDeleted] = useState(false);
  // State: edit modal + register modal
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const currentEditingUser = useMemo(() => {
    if (editingUserId == null) return null;
    return users.find((u) => (u.id ?? (u as any).ID) === editingUserId) || null;
  }, [editingUserId, users]);

  const filteredUsers = useMemo(() => {
    if (showDeleted) return users;
    return users.filter((u) => !(u.deleted_at ?? (u as any).DeletedAt));
  }, [users, showDeleted]);

  const roleValues: { value: PermissionRole; label: string }[] = [
    PermissionRole.GUEST,
    PermissionRole.USER,
    PermissionRole.EDITOR,
    PermissionRole.ADMIN,
  ].map((r) => ({ value: r, label: PermissionRoleLabel[r] }));

  try {
    return (
      <div className="flex flex-col h-full">
        <Heading>Administration</Heading>
        <Divider />
        <Card title="Server Information">
          <DescriptionList>
            <DescriptionTerm>Address</DescriptionTerm>
            <DescriptionDetails>
              {serverUrl ? (
                <Link href={serverUrl} target="_blank">
                  {serverUrl}
                </Link>
              ) : (
                <span className="text-zinc-500">Not connnected</span>
              )}
            </DescriptionDetails>
            <DescriptionTerm>Version</DescriptionTerm>
            <DescriptionDetails>
              {version ? (
                <Link
                  href={`https://github.com/Phalcode/gamevault-backend/releases/tag/${version}`}
                  target="_blank"
                >
                  {version}
                </Link>
              ) : (
                <span className="text-zinc-500">—</span>
              )}
            </DescriptionDetails>
            <DescriptionTerm>Users</DescriptionTerm>
            <DescriptionDetails>
              {users.length}{" "}
              {users.length > 0 && filteredUsers.length !== users.length && (
                <span className="text-zinc-400">
                  ({filteredUsers.length} shown)
                </span>
              )}
            </DescriptionDetails>
          </DescriptionList>
        </Card>
        <Card className="grid md:grid-cols-2 gap-4" title="Actions">
          <Button
            color="indigo"
            onClick={() => alert("Not yet implemented")}
            title="Reindex Games"
            className="items-center"
          >
            Backup & Restore Database
          </Button>
          <Button
            color="indigo"
            onClick={() => alert("Not yet implemented")}
            title="Reindex Games"
            className="items-center"
          >
            Reindex Games
          </Button>
        </Card>
        <Card title="Users">
          {error && (
            <div className="mb-4 rounded-md bg-red-500/10 p-3 text-sm text-red-500">
              {error}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-6 mb-4">
            <div className="flex items-center gap-3 text-xs text-zinc-400 select-none">
              <Switch
                name="showDeleted"
                color="indigo"
                checked={showDeleted}
                onChange={() => setShowDeleted((v) => !v)}
              />
              <span className="uppercase tracking-wide">
                Show deleted users
              </span>
            </div>
            <Button
              color="indigo"
              onClick={() => setShowRegister(true)}
              title="Register new user"
              className="items-center"
            >
              <UserPlusIcon className="size-5" />
              <span className="text-sm leading-none">Register User</span>
            </Button>
          </div>
          <Table className="[--gutter:--spacing(6)] sm:[--gutter:--spacing(8)]">
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Activated</TableHeader>
                <TableHeader>Role</TableHeader>
                <TableHeader>Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="py-6 text-center text-sm text-zinc-500">
                      Loading users…
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!loading && filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="py-6 text-center text-sm text-zinc-500">
                      No users found.
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {filteredUsers.map((u) => {
                const id = u.id ?? (u as any).ID;
                const deleted = u.deleted_at ?? (u as any).DeletedAt;
                const busy = opBusy[String(id)];
                const name = u.username || (u as any).Username || "Unknown User";
                const first_name = u.first_name || (u as any).FirstName;
                const last_name = u.last_name || (u as any).LastName;
                const email = u.email || (u as any).EMail;
                const avatarId = (u.avatar as any)?.id || (u.avatar as any)?.ID;
                const roleNumeric =
                  typeof u.role === "number"
                    ? (u.role as PermissionRole)
                    : PermissionRole.GUEST;
                return (
                  <TableRow key={id} className={deleted ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-4">
                        <AuthMediaAvatar
                          media={u.avatar as any}
                          size={48}
                          className="size-12"
                          square
                          alt={name}
                        />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            <span>
                              {name}{" "}
                              {(first_name || last_name) && (
                                <span className="font-normal">
                                  (
                                  {`${first_name ?? ""} ${last_name ?? ""}`.trim()}
                                  )
                                </span>
                              )}
                            </span>
                            {deleted && (
                              <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                                Deleted
                              </span>
                            )}
                          </div>
                          {email && (
                            <div className="text-zinc-500">
                              <a
                                href={`mailto:${email}`}
                                className="hover:text-zinc-700 dark:hover:text-zinc-300"
                              >
                                {email}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        name="activated"
                        color="indigo"
                        checked={!!u.activated}
                        disabled={!!deleted || busy}
                        onChange={() => toggleActivated(u)}
                      />
                    </TableCell>
                    <TableCell className="text-zinc-500">
                      <Listbox
                        name="role"
                        value={roleNumeric}
                        onChange={(val: any) =>
                          updateUserRole(u, Number(val) as PermissionRole)
                        }
                        disabled={!!deleted || busy}
                      >
                        {roleValues.map((r) => (
                          <ListboxOption key={r.value} value={r.value}>
                            <ListboxLabel>{r.label}</ListboxLabel>
                          </ListboxOption>
                        ))}
                      </Listbox>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-end">
                        {!deleted && (
                          <Button
                            color="rose"
                            disabled={busy}
                            onClick={() => deleteUser(u)}
                            title="Delete User"
                          >
                            <TrashIcon />{" "}
                            <span className="sr-only">Delete</span>
                          </Button>
                        )}
                        {deleted && (
                          <Button
                            color="green"
                            disabled={busy}
                            onClick={() => recoverUser(u)}
                            title="Recover User"
                          >
                            <ArrowPathIcon />{" "}
                            <span className="sr-only">Recover</span>
                          </Button>
                        )}
                        <Button
                          color="indigo"
                          onClick={() => setEditingUserId(Number(id))}
                          title="Edit User"
                          className="!bg-[--color-indigo-500]"
                          disabled={busy}
                        >
                          <PencilSquareIcon />{" "}
                          <span className="sr-only">Edit</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div id="portal-modals" className="contents">
            {currentEditingUser && (
              <UserEditorModalOld
                user={currentEditingUser as any}
                onClose={() => setEditingUserId(null)}
                onSave={async (payload) =>
                  updateUser(currentEditingUser, payload as any)
                }
                onUserUpdated={(updated) => {
                  setUsers((prev) =>
                    prev.map((u) =>
                      (u.id ?? (u as any).ID) ===
                      (updated.id ?? (updated as any).ID)
                        ? { ...u, ...updated }
                        : u,
                    ),
                  );
                }}
              />
            )}
            {showRegister && (
              <RegisterUserModalOld
                onClose={() => setShowRegister(false)}
                onRegistered={(u) => {
                  setUsers((prev) => [...prev, u]);
                }}
              />
            )}
          </div>
        </Card>
      </div>
    );
  } catch (e: any) {
    return (
      <div className="p-8 text-sm text-red-500 space-y-4">
        <p>Failed to render Administration page.</p>
        <pre className="whitespace-pre-wrap bg-red-500/10 p-4 rounded">
          {e?.message || String(e)}
        </pre>
      </div>
    );
  }
}
