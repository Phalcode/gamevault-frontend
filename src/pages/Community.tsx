import { Media } from "@/components/Media";
import { useAuth } from "@/context/AuthContext";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { Divider } from "@tw/divider";
import { Heading } from "@tw/heading";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { GamevaultUser } from "../api";

export default function Community() {
  const { serverUrl, authFetch, user: loggedIn } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<GamevaultUser[]>([]);
  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsLoading, setDetailsLoading] = useState<boolean>(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [fullUser, setFullUser] = useState<GamevaultUser | null>(null);
  const [progressSort, setProgressSort] = useState<"last" | "time" | "state">(
    "last",
  );

  useEffect(() => {
    let cancelled = false;
    if (!serverUrl) {
      setUsers([]);
      setCurrentUsername("");
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/users`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  const arr: GamevaultUser[] = await res.json();
  if (cancelled) return;
  // Exclude soft-deleted users (deleted_at present)
  const active = arr.filter(u => !(u as any).deleted_at);
  setUsers(active);
        // Default selection: logged-in user's username; else first user's username
        const loggedUsername = loggedIn?.username ?? null;
        const preferred =
          (loggedUsername &&
            active.find(
              (u) => (u.username ?? String(u.id)) === String(loggedUsername),
            )) ||
          active[0] ||
          null;
        setCurrentUsername(
          preferred ? (preferred.username ?? String(preferred.id)) : "",
        );
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load users");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, loggedIn]);

  const userKey = (u: GamevaultUser) => u.username ?? String(u.id);
  const current = useMemo(
    () => users.find((u) => userKey(u) === currentUsername) || null,
    [users, currentUsername],
  );

  const displayName = (u: GamevaultUser | null) => {
    if (!u) return "";
    const first = u.first_name;
    const last = u.last_name;
    const full = [first, last].filter(Boolean).join(" ").trim();
    return full || u.username || String(u.id);
  };

  const fullName = (u: GamevaultUser | null) => {
    if (!u) return "";
    const first = u.first_name;
    const last = u.last_name;
    return [first, last].filter(Boolean).join(" ").trim();
  };

  // Fetch full user details (including progresses) when selection changes
  useEffect(() => {
    let cancelled = false;
    setFullUser(null);
    setDetailsError(null);
    if (!serverUrl || !current?.id) return;
    (async () => {
      try {
        setDetailsLoading(true);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/users/${current.id}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok)
          throw new Error(`Failed to load user ${current.id} (${res.status})`);
        const usr = await res.json();
        if (!cancelled) setFullUser(usr);
      } catch (e: any) {
        if (!cancelled)
          setDetailsError(e?.message || "Failed to load user details");
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, current?.id]);

  const formatLastPlayed = (v: any): string => {
    if (v === null || v === undefined || v === "") return "—";
    let ms: number | null = null;
    if (typeof v === "number") {
      ms = v < 1e12 ? v * 1000 : v; // seconds vs ms
    } else if (typeof v === "string") {
      const num = Number(v);
      if (!isNaN(num)) ms = num < 1e12 ? num * 1000 : num;
      else {
        const d = new Date(v);
        ms = isNaN(d.getTime()) ? null : d.getTime();
      }
    } else if (v instanceof Date) {
      ms = v.getTime();
    }
    if (ms == null) return "—";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "—";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Heading>Community</Heading>
      <Divider />

      <div className="flex flex-wrap items-center justify-between gap-4 py-3">
        {/* Left: avatar + name + role */}
        <div className="flex items-center gap-3 min-w-0">
          <Media
            media={current?.avatar}
            size={48}
            className="size-12"
            alt={displayName(current)}
          />
          <div className="min-w-0">
            <div className="text-base font-semibold truncate max-w-[60vw] sm:max-w-[40vw]">
              {current
                ? `${current.username ?? String(current.id)}`
                : loading
                  ? "Loading…"
                  : "No users"}
            </div>
            {!!fullName(current) && (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[60vw] sm:max-w-[40vw]">
                {fullName(current)}
              </div>
            )}
            <div className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs border-zinc-300/60 text-zinc-700 dark:border-zinc-700/60 dark:text-zinc-200">
              {current?.role}
            </div>
          </div>
        </div>

        {/* Right: user switcher + sort */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              Switch user:
            </span>
            <div className="w-64">
              <Listbox
                name="userSelect"
                value={currentUsername}
                onChange={(v: any) => setCurrentUsername(String(v ?? ""))}
                disabled={!serverUrl || loading || users.length === 0}
              >
                {loading && (
                  <ListboxOption value="" disabled>
                    <ListboxLabel>Loading users…</ListboxLabel>
                  </ListboxOption>
                )}
                {!loading && users.length === 0 && (
                  <ListboxOption value="" disabled>
                    <ListboxLabel>No users</ListboxLabel>
                  </ListboxOption>
                )}
                {!loading &&
                  users.map((u) => (
                    <ListboxOption key={userKey(u)} value={userKey(u)}>
                      <ListboxLabel>
                        {u.username ?? String(u.id)} ({displayName(u)})
                      </ListboxLabel>
                    </ListboxOption>
                  ))}
              </Listbox>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              Sort by:
            </span>
            <div className="w-44">
              <Listbox
                name="progressSort"
                value={progressSort}
                onChange={(v: any) => setProgressSort(v)}
              >
                <ListboxOption value="last">
                  <ListboxLabel>Last played</ListboxLabel>
                </ListboxOption>
                <ListboxOption value="time">
                  <ListboxLabel>Time played</ListboxLabel>
                </ListboxOption>
                <ListboxOption value="state">
                  <ListboxLabel>State</ListboxLabel>
                </ListboxOption>
              </Listbox>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}

      {/* Progress list */}
      <div className="mt-6">
        {detailsError && (
          <div className="mb-3 text-sm text-rose-600 dark:text-rose-400">
            {detailsError}
          </div>
        )}
        {detailsLoading && (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Loading activity…
          </div>
        )}
        {!detailsLoading &&
          fullUser &&
          Array.isArray(fullUser.progresses) &&
          (fullUser.progresses.length > 0 ? (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              {(() => {
                const toMs = (v: any) => {
                  if (v == null || v === "") return -Infinity;
                  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
                  const n = Number(v);
                  if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
                  const d = new Date(v);
                  return isNaN(d.getTime()) ? -Infinity : d.getTime();
                };
                const minutesNum = (p: any) =>
                  Number(p.minutes_played ?? 0) || 0;
                const stateStr = (p: any) =>
                  String(p.state ?? "").toLowerCase();
                const sorted = [...fullUser.progresses].sort((a, b) => {
                  if (progressSort === "last")
                    return toMs(b.last_played_at) - toMs(a.last_played_at);
                  if (progressSort === "time")
                    return minutesNum(b) - minutesNum(a);
                  return stateStr(a).localeCompare(stateStr(b));
                });
                return sorted.map((p: any, idx: number) => {
                  const game = p.game ?? null;
                  const title: string = game?.title ?? "Unknown Game";
                  const state: string = p.state ?? "";
                  const minutes: number = Number(p.minutes_played ?? 0) || 0;
                  const last: any = p.last_played_at ?? null;
                  const coverId = game ? getGameCoverMediaId(game) : null;
                  const key = p.id ?? `${(game && game.id) || "g"}-${idx}`;
                  const hours = minutes / 60;
                  const openGame = () => {
                    if (!game?.id) return;
                    const base = (serverUrl || "").replace(/\/+$/, "");
                    if (base) {
                      window.location.href = `${base}/library/${game.id}`;
                    } else {
                      navigate(`/library/${game.id}`);
                    }
                  };
                  const onKey: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openGame();
                    }
                  };
                  return (
                    <div
                      key={String(key)}
                      className="flex items-center gap-4 p-3"
                    >
                      <div
                        className="shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg"
                        role="button"
                        tabIndex={0}
                        onClick={openGame}
                        onKeyDown={onKey}
                        title={title}
                      >
                        {coverId ? (
                          <Media
                            media={{ id: coverId } as any}
                            width={48}
                            height={64}
                            className="rounded-lg"
                            square
                            alt={title}
                          />
                        ) : (
                          <div
                            className="rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-600 dark:text-zinc-400"
                            style={{ width: 48, height: 64 }}
                          >
                            No Cover
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {title}
                        </div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400 flex flex-wrap gap-x-4 gap-y-1">
                          {state && <span>State: {state}</span>}
                          <span>
                            Time Played:{" "}
                            {hours >= 1
                              ? `${hours.toFixed(hours < 10 ? 1 : 0)} h`
                              : `${minutes} min`}
                          </span>
                          <span>Last Played: {formatLastPlayed(last)}</span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            !detailsLoading && (
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                No activity found.
              </div>
            )
          ))}
      </div>
    </div>
  );
}
