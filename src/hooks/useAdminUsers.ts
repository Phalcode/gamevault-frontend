import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useRef, useState } from "react";
// Local helper to normalize user objects if backend changes shape; currently identity
function normalizeUser<T>(u: T): T {
  return u;
}
import { GamevaultUser, GamevaultUserRoleEnum } from "../api";

export interface UseAdminUsersResult {
  users: GamevaultUser[];
  loading: boolean;
  error: string | null;
  refresh: (force?: boolean) => void;
  opBusy: Record<string, boolean>;
  toggleActivated: (u: GamevaultUser) => Promise<void>;
  deleteUser: (u: GamevaultUser) => Promise<void>;
  recoverUser: (u: GamevaultUser) => Promise<void>;
  updateUser: (
    u: GamevaultUser,
    payload: Partial<GamevaultUser> & { password?: string | null },
  ) => Promise<{ ok: boolean; message?: string }>;
  updateUserRole: (
    u: GamevaultUser,
    role: GamevaultUserRoleEnum,
  ) => Promise<void>;
  setUsers: React.Dispatch<React.SetStateAction<GamevaultUser[]>>;
}

export function useAdminUsers(): UseAdminUsersResult {
  const { auth, serverUrl, authFetch } = useAuth();
  const [users, setUsers] = useState<GamevaultUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opBusy, setOpBusy] = useState<Record<string, boolean>>({});
  const fetchedRef = useRef(false);
  const setUserOpBusy = (id: string | number, busy: boolean) =>
    setOpBusy((m) => ({ ...m, [String(id)]: busy }));
  const safeBase = serverUrl?.replace(/\/+$/, "");

  const fetchUsers = useCallback(
    async (force = false) => {
      if (!auth || !safeBase) return;
      if (fetchedRef.current && !force) return;
      let cancelled = false;
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`${safeBase}/api/users`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok)
          throw new Error(
            `Fetching users failed (${res.status}): ${(await res.text()) || res.statusText}`,
          );
        const list = await res.json();
        if (cancelled) return;
        setUsers(list);
        fetchedRef.current = true;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
      return () => {
        cancelled = true;
      };
    },
    [auth, safeBase, authFetch],
  );
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);
  const refresh = (force = true) => {
    if (force) fetchedRef.current = false;
    fetchUsers(force);
  };

  const toggleActivated = async (u: GamevaultUser) => {
    if (!safeBase) return;
    const uid = u.id;
    if (!uid || opBusy[uid]) return;
    const current = !!u.activated;
    const next = !current;
    setUsers((prev) =>
      prev.map((x) => (x.id === uid ? { ...x, activated: next } : x)),
    );
    setUserOpBusy(uid, true);
    try {
      const res = await authFetch(`${safeBase}/api/users/${uid}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ activated: next }),
      });
      if (!res.ok)
        throw new Error(
          `Activation update failed (${res.status}): ${(await res.text()) || res.statusText}`,
        );
      let updated: any = null;
      try {
        updated = await res.json();
      } catch {}
      if (updated && typeof updated === "object") {
        setUsers((prev) =>
          prev.map((x) =>
            x.id === uid ? normalizeUser({ ...x, ...updated }) : x,
          ),
        );
      }
    } catch {
      setUsers((prev) =>
        prev.map((x) => (x.id === uid ? { ...x, activated: current } : x)),
      );
    } finally {
      setUserOpBusy(uid, false);
    }
  };

  const deleteUser = async (u: GamevaultUser) => {
    if (!safeBase) return;
    const uid = u.id;
    if (!uid || opBusy[uid]) return;
    setUserOpBusy(uid, true);
    try {
      const res = await authFetch(`${safeBase}/api/users/${uid}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!res.ok && res.status !== 204)
        throw new Error(
          `Delete failed (${res.status}): ${(await res.text()) || res.statusText}`,
        );
      let updated: any = null;
      if (res.status !== 204) {
        try {
          updated = await res.json();
        } catch {}
      }
      setUsers((prev) =>
        prev.map((x) => {
          if (x.id === uid) {
            if (updated && ("deleted_at" in updated || "DeletedAt" in updated))
              return normalizeUser({ ...x, ...updated });
            return { ...x, deleted_at: new Date().toISOString() };
          }
          return x;
        }),
      );
    } catch {
    } finally {
      setUserOpBusy(uid, false);
    }
  };

  const recoverUser = async (u: GamevaultUser) => {
    if (!safeBase) return;
    const uid = u.id;
    if (!uid || opBusy[uid]) return;
    setUserOpBusy(uid, true);
    try {
      const res = await authFetch(`${safeBase}/api/users/${uid}/recover`, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: "",
      });
      if (!res.ok)
        throw new Error(
          `Recover failed (${res.status}): ${(await res.text()) || res.statusText}`,
        );
      let updated: any = null;
      try {
        updated = await res.json();
      } catch {}
      setUsers((prev) =>
        prev.map((x) => {
          if (x.id === uid) {
            if (updated && ("deleted_at" in updated || "DeletedAt" in updated))
              return normalizeUser({ ...x, ...updated });
            return { ...x, deleted_at: null, DeletedAt: null };
          }
          return x;
        }),
      );
    } catch {
    } finally {
      setUserOpBusy(uid, false);
    }
  };

  const updateUser = async (
    u: GamevaultUser,
    payload: Partial<GamevaultUser> & { password?: string | null },
  ) => {
    if (!safeBase) return { ok: false, message: "No server base URL" };
    const id = u.id;
    try {
      const body: Record<string, any> = {
        username: payload.username,
        email: payload.email,
        first_name: payload.first_name,
        last_name: payload.last_name,
        birth_date: payload.birth_date ?? null,
      };
      if (payload.password && payload.password.trim().length)
        body.password = payload.password;
      const res = await authFetch(`${safeBase}/api/users/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok)
        return {
          ok: false,
          message: `Save failed (${res.status}): ${(await res.text()) || res.statusText}`,
        };
      const updated = await res.json();
      setUsers((prev) =>
        prev.map((x) =>
          x.id === id ? normalizeUser({ ...x, ...updated }) : x,
        ),
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  };

  const updateUserRole = async (
    u: GamevaultUser,
    newRole: GamevaultUserRoleEnum,
  ) => {
    if (!safeBase) return;
    const uid = u.id;
    if (!uid || opBusy[uid]) return;
    const originalRole = u.role;
    setUsers((prev) =>
      prev.map((x) => (x.id === uid ? { ...x, role: newRole } : x)),
    );
    setUserOpBusy(uid, true);
    try {
      const res = await authFetch(`${safeBase}/api/users/${uid}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok)
        throw new Error(
          `Role update failed (${res.status}): ${(await res.text()) || res.statusText}`,
        );
      let updated: any = null;
      try {
        updated = await res.json();
      } catch {}
      if (updated && typeof updated === "object") {
        setUsers((prev) =>
          prev.map((x) =>
            x.id === uid ? normalizeUser({ ...x, ...updated }) : x,
          ),
        );
      }
    } catch {
      setUsers((prev) =>
        prev.map((x) => (x.id === uid ? { ...x, role: originalRole } : x)),
      );
    } finally {
      setUserOpBusy(uid, false);
    }
  };

  return {
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
  };
}
