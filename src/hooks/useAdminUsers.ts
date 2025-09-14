import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { User, PermissionRole, normalizePermissionRole } from '@/types/api'

export interface UseAdminUsersResult {
  users: User[]
  loading: boolean
  error: string | null
  refresh: (force?: boolean) => void
  opBusy: Record<string, boolean>
  toggleActivated: (u: User) => Promise<void>
  deleteUser: (u: User) => Promise<void>
  recoverUser: (u: User) => Promise<void>
  updateUser: (u: User, payload: Partial<User> & { password?: string | null }) => Promise<{ ok: boolean; message?: string }>
  updateUserRole: (u: User, role: PermissionRole) => Promise<void>
  setUsers: React.Dispatch<React.SetStateAction<User[]>>
}

function normalizeActivation(u: User): User { const raw: any = u.activated ?? (u as any).Activated; const active = raw === true || raw === 1 || raw === 'activated'; return { ...u, activated: active } }
function normalizeUser(u: User): User { return { ...normalizeActivation(u), role: normalizePermissionRole((u as any).role) } }

export function useAdminUsers(): UseAdminUsersResult {
  const { auth, serverUrl, authFetch } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opBusy, setOpBusy] = useState<Record<string, boolean>>({})
  const fetchedRef = useRef(false)
  const setUserOpBusy = (id: string | number, busy: boolean) => setOpBusy((m) => ({ ...m, [String(id)]: busy }))
  const safeBase = serverUrl?.replace(/\/+$/, '')

  const fetchUsers = useCallback(async (force = false) => {
    if (!auth || !safeBase) return; if (fetchedRef.current && !force) return; let cancelled = false; setLoading(true); setError(null); try { const res = await authFetch(`${safeBase}/api/users`, { headers: { Accept: 'application/json' } }); if (!res.ok) throw new Error(`Fetching users failed (${res.status}): ${(await res.text()) || res.statusText}`); const data = await res.json(); if (cancelled) return; const list: User[] = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as any).items) ? (data as any).items : []; setUsers(list.map(normalizeUser)); fetchedRef.current = true } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) } finally { if (!cancelled) setLoading(false) } return () => { cancelled = true } }, [auth, safeBase, authFetch])
  useEffect(() => { fetchUsers() }, [fetchUsers])
  const refresh = (force = true) => { if (force) fetchedRef.current = false; fetchUsers(force) }

  const toggleActivated = async (u: User) => { if (!safeBase) return; const uid = u.id ?? (u as any).ID; if (!uid || opBusy[uid]) return; const current = !!u.activated; const next = !current; setUsers((prev) => prev.map((x) => (x.id ?? (x as any).ID) === uid ? { ...x, activated: next } : x)); setUserOpBusy(uid, true); try { const res = await authFetch(`${safeBase}/api/users/${uid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ activated: next }) }); if (!res.ok) throw new Error(`Activation update failed (${res.status}): ${(await res.text()) || res.statusText}`); let updated: any = null; try { updated = await res.json() } catch {} if (updated && typeof updated === 'object') { setUsers((prev) => prev.map((x) => (x.id ?? (x as any).ID) === uid ? normalizeUser({ ...x, ...updated }) : x)) } } catch { setUsers((prev) => prev.map((x) => (x.id ?? (x as any).ID) === uid ? { ...x, activated: current } : x)) } finally { setUserOpBusy(uid, false) } }

  const deleteUser = async (u: User) => { if (!safeBase) return; const uid = u.id ?? (u as any).ID; if (!uid || opBusy[uid]) return; setUserOpBusy(uid, true); try { const res = await authFetch(`${safeBase}/api/users/${uid}`, { method: 'DELETE', headers: { Accept: 'application/json' } }); if (!res.ok && res.status !== 204) throw new Error(`Delete failed (${res.status}): ${(await res.text()) || res.statusText}`); let updated: any = null; if (res.status !== 204) { try { updated = await res.json() } catch {} } setUsers((prev) => prev.map((x) => { if ((x.id ?? (x as any).ID) === uid) { if (updated && ('deleted_at' in updated || 'DeletedAt' in updated)) return normalizeUser({ ...x, ...updated }); return { ...x, deleted_at: new Date().toISOString() } } return x })) } catch { } finally { setUserOpBusy(uid, false) } }

  const recoverUser = async (u: User) => { if (!safeBase) return; const uid = u.id ?? (u as any).ID; if (!uid || opBusy[uid]) return; setUserOpBusy(uid, true); try { const res = await authFetch(`${safeBase}/api/users/${uid}/recover`, { method: 'POST', headers: { Accept: 'application/json' }, body: '' }); if (!res.ok) throw new Error(`Recover failed (${res.status}): ${(await res.text()) || res.statusText}`); let updated: any = null; try { updated = await res.json() } catch {} setUsers((prev) => prev.map((x) => { if ((x.id ?? (x as any).ID) === uid) { if (updated && ('deleted_at' in updated || 'DeletedAt' in updated)) return normalizeUser({ ...x, ...updated }); return { ...x, deleted_at: null, DeletedAt: null } } return x })) } catch { } finally { setUserOpBusy(uid, false) } }

  const updateUser = async (u: User, payload: Partial<User> & { password?: string | null }) => { if (!safeBase) return { ok: false, message: 'No server base URL' }; const id = u.id ?? (u as any).ID; try { const body: Record<string, any> = { username: payload.username, email: payload.email, first_name: payload.first_name, last_name: payload.last_name, birth_date: payload.birth_date ?? null }; if (payload.password && payload.password.trim().length) body.password = payload.password; const res = await authFetch(`${safeBase}/api/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }); if (!res.ok) return { ok: false, message: `Save failed (${res.status}): ${(await res.text()) || res.statusText}` }; const updated = await res.json(); setUsers((prev) => prev.map((x) => (x.id ?? (x as any).ID) === id ? normalizeUser({ ...x, ...updated }) : x)); return { ok: true } } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) } } }

  const updateUserRole = async (u: User, newRole: PermissionRole) => { if (!safeBase) return; const uid = u.id ?? (u as any).ID; if (!uid || opBusy[uid]) return; const originalRole = normalizePermissionRole(u.role); setUsers((prev) => prev.map((x) => (x.id ?? (x as any).ID) === uid ? { ...x, role: newRole } : x)); setUserOpBusy(uid, true); try { const res = await authFetch(`${safeBase}/api/users/${uid}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ role: newRole }) }); if (!res.ok) throw new Error(`Role update failed (${res.status}): ${(await res.text()) || res.statusText}`); let updated: any = null; try { updated = await res.json() } catch {} if (updated && typeof updated === 'object') { setUsers((prev) => prev.map((x) => (x.id ?? (x as any).ID) === uid ? normalizeUser({ ...x, ...updated }) : x)) } } catch { setUsers((prev) => prev.map((x) => (x.id ?? (x as any).ID) === uid ? { ...x, role: originalRole } : x)) } finally { setUserOpBusy(uid, false) } }

  return { users, loading, error, refresh, opBusy, toggleActivated, deleteUser, recoverUser, updateUser, updateUserRole, setUsers }
}
