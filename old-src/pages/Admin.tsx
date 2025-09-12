import { useState, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useAdminUsers } from "../hooks/useAdminUsers";
import { User, PermissionRole, PermissionRoleLabel } from "../types/api";
import { UserCard } from "../components/admin/UserCard";
import { UserEditorModal } from "../components/admin/UserEditorModal";
import { MaterialSymbolsLightDirectorySyncRounded } from "../components/admin/MaterialSymbolsLightDirectorySyncRounded";
import { MaterialSymbolsPersonAddRounded } from "../components/admin/MaterialSymbolsPersonAddRounded";
import { RegisterUserModal } from "../components/admin/RegisterUserModal";
import { useServerStatus } from "../hooks/useServerStatus";

export function AdminPage() {
  const { user: currentUser, serverUrl } = useAuth();

  // Determine current role first
  const roleNum =
    typeof currentUser?.role === "number"
      ? (currentUser.role as PermissionRole)
      : null;
  const isAdmin = roleNum === PermissionRole.ADMIN;

  // Always gate content for non-admins BEFORE loading expensive admin data
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-stretch min-h-0 pt-0">
        <h2 className="m-0 mb-4 text-[1.65rem] font-semibold tracking-wide leading-tight">
          Admin
        </h2>
        <div
          className="mt-5 px-5 py-4 rounded-[16px] text-[0.8rem] tracking-[.5px] text-[#e0dff0] bg-[linear-gradient(120deg,#3a3344,#2a2733)] border border-[#443d52]"
          role="alert"
        >
          You do not have permission to view this page.
        </div>
      </div>
    );
  }

  // Safe to load admin data only when user is admin
  const {
    users,
    loading,
    error,
    refresh,
    opBusy,
    toggleActivated,
    deleteUser,
    recoverUser,
    updateUser,
    updateUserRole,
    setUsers,
  } = useAdminUsers();
  const { info: serverInfo } = useServerStatus();

  const [showDeleted, setShowDeleted] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const requiredRegFields = new Set(
    serverInfo?.required_registration_fields || [],
  );

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => {
        const del = u.deleted_at ?? (u as any).DeletedAt;
        return showDeleted || del == null;
      }),
    [users, showDeleted],
  );

  const deletedCount = useMemo(
    () =>
      users.reduce(
        (n, u) => ((u.deleted_at ?? (u as any).DeletedAt) != null ? n + 1 : n),
        0,
      ),
    [users],
  );

  return (
    <div className="flex flex-col items-stretch min-h-0 pt-0">
      <h2 className="m-0 mb-4 text-[1.65rem] font-semibold tracking-wide leading-tight">
        Admin
      </h2>

      <div
        className="relative flex flex-col rounded-[18px] border border-[#2c2b38] hover:border-accent/50 transition-colors bg-[linear-gradient(150deg,rgba(27,26,39,0.88),rgba(35,34,48,0.92))] p-6 shadow-[0_8px_40px_-18px_rgba(0,0,0,0.65),0_4px_22px_-8px_rgba(0,0,0,0.55)] backdrop-blur-md overflow-hidden min-h-0
        before:content-[''] before:absolute before:w-[560px] before:h-[560px] before:rounded-full before:opacity-40 before:blur-xl before:top-[-260px] before:right-[-220px] before:pointer-events-none before:bg-[radial-gradient(circle_at_center,rgba(100,89,223,0.28),transparent_70%)]
        after:content-[''] after:absolute after:w-[620px] after:h-[620px] after:rounded-full after:opacity-25 after:blur-2xl after:bottom-[-300px] after:left-[-260px] after:pointer-events-none after:bg-[radial-gradient(circle_at_center,rgba(100,89,223,0.22),transparent_75%)]"
        aria-hidden={!!editingUser}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="m-0 text-sm font-medium tracking-wide text-white/90 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(100,89,223,0.4)]" />
              User List
            </p>
            <p className="text-[0.65rem] opacity-60 mt-[2px]">
              Current role:{" "}
              {roleNum != null ? PermissionRoleLabel[roleNum] : "unknown"}
            </p>
          </div>
          <label className="relative inline-flex items-center gap-2 cursor-pointer select-none text-[0.7rem] bg-[rgba(32,31,45,0.5)] px-2.5 pr-3 py-1.5 rounded-xl border border-[#2d2c38]">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(e) => setShowDeleted(e.target.checked)}
              className="absolute opacity-0 pointer-events-none"
              aria-label="Show deleted users"
              disabled={!!editingUser}
            />
            <span
              className={[
                "relative inline-block w-9 h-[18px] rounded-full transition-colors duration-300",
                showDeleted
                  ? "bg-[linear-gradient(120deg,#6d63f0,#574ae3)]"
                  : "bg-[#2c2b38]",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,.4)] transition-transform duration-300 ease-[cubic-bezier(.4,.2,.2,1)]",
                  showDeleted ? "translate-x-[18px]" : "translate-x-[2px]",
                ].join(" ")}
              />
            </span>
            <span className="font-semibold tracking-[.5px] opacity-80 uppercase">
              Show deleted users
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => refresh(true)}
              disabled={loading || !!editingUser || registerOpen}
              aria-label="Refresh user list"
              title="Reload users from server"
              className={[
                "w-[38px] h-[38px] rounded-[14px] inline-flex items-center justify-center p-0 border transition-colors duration-300",
                loading || editingUser || registerOpen
                  ? "bg-[linear-gradient(120deg,#343445,#30303f)] border-[#424357] text-[#9c9db0]"
                  : "bg-[linear-gradient(120deg,#3c4663,#465b85)] border-[#5773a8] text-[#e4e8f3] shadow-[0_2px_4px_-1px_rgba(0,0,0,.4)] hover:brightness-110",
              ].join(" ")}
            >
              <span className={loading ? "animate-spin" : ""}>
                <MaterialSymbolsLightDirectorySyncRounded
                  width={20}
                  height={20}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              disabled={!!editingUser || loading || registerOpen}
              aria-label="Registrate new User"
              title="Registrate new User"
              className={[
                "w-[38px] h-[38px] rounded-[14px] inline-flex items-center justify-center p-0 border transition-colors duration-300",
                editingUser || loading || registerOpen
                  ? "bg-[linear-gradient(120deg,#3e3545,#362d3c)] border-[#4a4152] text-[#b1a9bb]"
                  : "bg-[linear-gradient(120deg,#5c53d8,#7269ff)] border-[#6d63f0] text-white shadow-[0_2px_4px_-1px_rgba(0,0,0,.45)] hover:brightness-110",
              ].join(" ")}
            >
              <MaterialSymbolsPersonAddRounded width={20} height={20} />
            </button>
          </div>
          <span className="text-[0.6rem] opacity-55 tracking-[.5px] ml-auto pr-1">
            Total: {users.length} • Deleted: {deletedCount} • Visible:{" "}
            {filteredUsers.length}
          </span>
        </div>

        {loading && (
          <div className="text-[0.8rem] opacity-75 mt-3">Loading users…</div>
        )}
        {error && !loading && (
          <div className="mt-3 px-2.5 py-2 rounded-lg bg-[#4c1f1f] text-[#ffe4e4] text-[0.75rem] leading-snug whitespace-pre-wrap border border-[#743232]">
            {error}
          </div>
        )}

        {!loading && !error && filteredUsers.length === 0 && (
          <div className="text-[0.8rem] opacity-75 mt-3">
            {users.length === 0
              ? "No users returned."
              : "No users match current filter (all are deleted)."}
          </div>
        )}

        {!loading && !error && filteredUsers.length > 0 && (
          <div className="mt-3 overflow-y-auto max-h-[calc(100vh-250px)] pr-1.5 scrollbar-thin">
            <ul className="list-none mt-4 p-0 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              {filteredUsers.map((u) => {
                const uid = u.id ?? (u as any).ID;
                const busy = !!opBusy[uid];
                return (
                  <UserCard
                    key={uid}
                    user={u}
                    serverUrl={serverUrl}
                    busy={busy}
                    editing={!!editingUser}
                    onEdit={(user) => setEditingUser(user)}
                    onToggleActive={toggleActivated}
                    onDelete={deleteUser}
                    onRecover={recoverUser}
                    onChangeRole={(user, newRole) =>
                      updateUserRole(user, newRole)
                    }
                  />
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {editingUser && (
        <UserEditorModal
          user={editingUser}
          onClose={() => !loading && setEditingUser(null)}
          onSave={async (payload) => {
            const res = await updateUser(editingUser, payload);
            if (res.ok) {
              setEditingUser((prev) =>
                prev ? { ...prev, ...payload, password: undefined } : prev,
              );
            }
            return res;
          }}
        />
      )}
      {registerOpen && (
        <RegisterUserModal
          onClose={() => setRegisterOpen(false)}
          onRegistered={(u) => {
            setUsers((prev) => [...prev, u]);
            setRegisterOpen(false);
          }}
          requiredFields={requiredRegFields}
        />
      )}
    </div>
  );
}

// All former inline style blocks replaced with Tailwind utility classes above.
