import { Badge } from "@/components/tailwind/badge";
import { Button } from "@/components/tailwind/button";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { Divider } from "@tw/divider";
import { Heading, Subheading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { Text } from "@tw/text";
import { UserAvatar } from "@/components/UserAvatar";
import { Media } from "@/components/Media";
import { useAuth } from "@/context/AuthContext";
import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { getRoleLabel } from "@/utils/roles";
import clsx from "clsx";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircleIcon,
  ClockIcon,
  PlayCircleIcon,
  SparklesIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { GamevaultGame, GamevaultUser, Progress } from "../api";

type UserDetailsMap = Record<number, GamevaultUser>;
type ProfileProgressSort = "last" | "time" | "title" | "state";

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

const PROGRESS_STATE_META: Record<
  string,
  { label: string; tone: string; chip: keyof typeof badgeTones }
> = {
  UNPLAYED: { label: "Unplayed", tone: "text-gv-muted", chip: "zinc" },
  INFINITE: { label: "Ongoing", tone: "text-sky-400", chip: "blue" },
  PLAYING: { label: "Playing", tone: "text-emerald-400", chip: "green" },
  COMPLETED: { label: "Finished", tone: "text-violet-300", chip: "indigo" },
  ABORTED_TEMPORARY: { label: "On hold", tone: "text-amber-400", chip: "amber" },
  ABORTED_PERMANENT: { label: "Dropped", tone: "text-rose-400", chip: "rose" },
};

const badgeTones = {
  zinc: true,
  blue: true,
  green: true,
  indigo: true,
  amber: true,
  rose: true,
} as const;

const PROFILE_FILTER_OPTIONS = [
  { value: "all", label: "All states" },
  { value: "PLAYING", label: "Playing" },
  { value: "INFINITE", label: "Ongoing" },
  { value: "COMPLETED", label: "Finished" },
  { value: "ABORTED_TEMPORARY", label: "On hold" },
  { value: "ABORTED_PERMANENT", label: "Dropped" },
  { value: "UNPLAYED", label: "Unplayed" },
] as const;

const PROFILE_SORT_OPTIONS: { value: ProfileProgressSort; label: string }[] = [
  { value: "last", label: "Last played" },
  { value: "time", label: "Playtime" },
  { value: "title", label: "Title" },
  { value: "state", label: "State" },
];

function normalizeUser<T>(user: T): T {
  if (!user || typeof user !== "object") return user;

  const candidate = user as T & { role?: unknown };
  if (typeof candidate.role === "number") {
    return { ...candidate, role: String(candidate.role) } as T;
  }

  return user;
}

function toTimestamp(value: unknown) {
  if (value == null || value === "") return -Infinity;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? -Infinity : date.getTime();
  }
  if (value instanceof Date) return value.getTime();
  return -Infinity;
}

function formatDate(value: unknown, fallback = "Never") {
  const timestamp = toTimestamp(value);
  if (timestamp === -Infinity) return fallback;

  try {
    return new Date(timestamp).toLocaleDateString();
  } catch {
    return fallback;
  }
}

function formatPlaytime(minutes: number) {
  if (!minutes) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

function getDisplayName(user: GamevaultUser | null | undefined) {
  if (!user) return "Unknown User";
  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || user.username || `User #${user.id}`;
}

function getUserHandle(user: GamevaultUser | null | undefined) {
  if (!user) return "unknown";
  return user.username || `user-${user.id}`;
}

function getAvatarFallback(user: GamevaultUser | null | undefined) {
  const source = getDisplayName(user)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,rgba(84,73,198,0.32),rgba(24,24,39,0.96))] text-sm font-bold uppercase tracking-[0.14em] text-white/90">
      {source || "GV"}
    </div>
  );
}

function getProgresses(user: GamevaultUser | null | undefined) {
  return Array.isArray(user?.progresses) ? user.progresses : [];
}

function getRecentProgresses(user: GamevaultUser | null | undefined, limit = 6) {
  return [...getProgresses(user)]
    .sort(
      (left, right) =>
        toTimestamp(right.last_played_at) - toTimestamp(left.last_played_at),
    )
    .slice(0, limit);
}

function getRecentWindowProgresses(
  user: GamevaultUser | null | undefined,
  sinceMs: number,
) {
  return getProgresses(user)
    .filter((progress) => toTimestamp(progress.last_played_at) >= sinceMs)
    .sort(
      (left, right) =>
        toTimestamp(right.last_played_at) - toTimestamp(left.last_played_at),
    );
}

function getBookmarkedGames(user: GamevaultUser | null | undefined) {
  return Array.isArray(user?.bookmarked_games) ? user.bookmarked_games : [];
}

function getPrimaryBackdropMediaId(user: GamevaultUser | null | undefined) {
  if (!user) return null;
  if (user.background?.id) return user.background.id;

  const fromRecentBackground = getRecentProgresses(user, 12).find(
    (progress) => progress.game?.metadata?.background?.id,
  );
  if (fromRecentBackground?.game?.metadata?.background?.id) {
    return fromRecentBackground.game.metadata.background.id;
  }

  const fromRecentCover = getRecentProgresses(user, 12)
    .map((progress) => getGameCoverMediaId(progress.game as GamevaultGame))
    .find(Boolean);
  if (fromRecentCover) return Number(fromRecentCover);

  const bookmarkCover = getBookmarkedGames(user)
    .map((game) => getGameCoverMediaId(game))
    .find(Boolean);
  return bookmarkCover ? Number(bookmarkCover) : null;
}

function getUserStats(user: GamevaultUser | null | undefined) {
  const progresses = getProgresses(user);
  const totalMinutes = progresses.reduce(
    (sum, progress) => sum + (Number(progress.minutes_played ?? 0) || 0),
    0,
  );
  const completed = progresses.filter(
    (progress) => progress.state === "COMPLETED",
  ).length;
  const playing = progresses.filter(
    (progress) =>
      progress.state === "PLAYING" || progress.state === "INFINITE",
  ).length;

  return {
    tracked: progresses.length,
    totalMinutes,
    completed,
    playing,
    bookmarks: getBookmarkedGames(user).length,
    lastPlayed: getRecentProgresses(user, 1)[0]?.last_played_at,
  };
}

function getRoleBadgeColor(role?: string) {
  const numericRole = Number(role ?? 0);
  if (numericRole >= 3) return "amber" as const;
  if (numericRole >= 2) return "indigo" as const;
  return "zinc" as const;
}

function getProgressMeta(state?: string) {
  return PROGRESS_STATE_META[state || "UNPLAYED"] || PROGRESS_STATE_META.UNPLAYED;
}

function GamePoster({
  game,
  title,
  width,
  height,
  className,
}: {
  game?: GamevaultGame | null;
  title: string;
  width: number;
  height: number;
  className?: string;
}) {
  const coverId = game ? getGameCoverMediaId(game) : null;
  const placeholderSize = width >= 120 ? "normal" : "small";

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-2xl border border-gv-line/70 bg-gv-panel-soft shadow-sm",
        className,
      )}
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {coverId ? (
        <Media
          media={{ id: Number(coverId) } as any}
          width={width}
          height={height}
          square
          alt={title}
          className="h-full w-full rounded-2xl"
          fallback={
            <CoverPlaceholder
              title={title}
              size={placeholderSize}
              className="h-full w-full"
            />
          }
        />
      ) : (
        <CoverPlaceholder
          title={title}
          size={placeholderSize}
          className="h-full w-full"
        />
      )}
    </div>
  );
}

function NetworkUserCard({
  user,
  isCurrentUser,
}: {
  user: GamevaultUser;
  isCurrentUser: boolean;
}) {
  const stats = getUserStats(user);
  const recent = getRecentProgresses(user, 3);

  return (
    <Link
      to={`/community/${user.id}`}
      className="group block rounded-[1.75rem] focus:outline-none focus:ring-2 focus:ring-gv-accent-cool"
    >
      <article
        className={clsx(
          "surface-panel relative overflow-hidden rounded-[1.75rem] p-5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-gv-line-strong hover:shadow-(--shadow-shell)",
          isCurrentUser && "ring-1 ring-gv-accent/35",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(132,123,237,0.16),transparent_72%)]" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <UserAvatar
                media={user.avatar}
                size={76}
                alt={getDisplayName(user)}
                fallback={getAvatarFallback(user)}
                className="border border-gv-line/70 bg-gv-panel-soft shadow-sm"
              />
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-semibold tracking-[-0.02em] text-gv-text">
                    {getDisplayName(user)}
                  </h3>
                  {isCurrentUser && <Badge color="indigo">You</Badge>}
                  <Badge color={getRoleBadgeColor(user.role)}>
                    {getRoleLabel(Number(user.role))}
                  </Badge>
                </div>
                <div className="truncate text-sm text-gv-muted">
                  @{getUserHandle(user)}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gv-muted">
                  <span>Last seen {formatDate(stats.lastPlayed)}</span>
                  <span>{formatPlaytime(stats.totalMinutes)} logged</span>
                </div>
              </div>
            </div>

            <ArrowRightIcon className="size-5 shrink-0 text-gv-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-gv-accent-cool" />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Tracked", value: stats.tracked },
              { label: "In progress", value: stats.playing },
              { label: "Finished", value: stats.completed },
              { label: "Saved", value: stats.bookmarks },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-gv-line/70 bg-gv-panel-soft px-3 py-2 text-center"
              >
                <div className="truncate text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-gv-muted">
                  {item.label}
                </div>
                <div className="mt-2 text-lg font-semibold text-gv-text" data-numeric>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <div className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
              Recently played
            </div>
            <div className="flex gap-2 overflow-hidden">
              {recent.length > 0 ? (
                recent.map((progress) => {
                  const game = progress.game;
                  const title = game?.metadata?.title || game?.title || "Game";
                  return (
                    <GamePoster
                      key={progress.id}
                      game={game || undefined}
                      title={title}
                      width={80}
                      height={108}
                      className="shrink-0"
                    />
                  );
                })
              ) : (
                <div className="flex h-27 w-full items-center justify-center rounded-2xl border border-dashed border-gv-line bg-gv-panel-soft text-sm text-gv-muted">
                  Fresh profile. No activity yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function ProfileProgressCard({ progress }: { progress: Progress }) {
  const game = progress.game;
  const title = game?.metadata?.title || game?.title || "Unknown Game";
  const meta = getProgressMeta(progress.state);

  return (
    <Link
      to={game?.id ? `/library/${game.id}` : "/library"}
      className="group block rounded-3xl focus:outline-none focus:ring-2 focus:ring-gv-accent-cool"
    >
      <article className="surface-panel h-full rounded-3xl p-4 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-gv-line-strong hover:shadow-(--shadow-shell)">
        <div className="flex gap-4">
          <GamePoster
            game={game || undefined}
            title={title}
            width={88}
            height={120}
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <h3 className="line-clamp-2 min-w-0 flex-1 text-base font-semibold tracking-[-0.02em] text-gv-text">
                {title}
              </h3>
              <Badge color={meta.chip} className="shrink-0 self-start">
                {meta.label}
              </Badge>
            </div>
            <div className="mt-3 space-y-2 text-sm text-gv-muted">
              <div className="flex items-center gap-2">
                <ClockIcon className="size-4 text-gv-accent-cool" />
                <span>{formatPlaytime(Number(progress.minutes_played ?? 0) || 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-gv-accent-cool" />
                <span>Last played {formatDate(progress.last_played_at)}</span>
              </div>
            </div>
            <div className="mt-4 text-xs uppercase tracking-[0.16em] text-gv-muted/80">
              Open game page
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

export default function Community() {
  const { serverUrl, authFetch, user: loggedIn } = useAuth();
  const { id } = useParams<{ id?: string }>();

  const [users, setUsers] = useState<GamevaultUser[]>([]);
  const [detailsById, setDetailsById] = useState<UserDetailsMap>({});
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");

  const currentUserId = (loggedIn as any)?.id ?? (loggedIn as any)?.ID ?? null;
  const recentCutoff = useMemo(() => Date.now() - TWO_WEEKS_MS, []);

  const fetchUserDetail = useCallback(
    async (userId: number) => {
      if (!serverUrl) return null;
      const base = serverUrl.replace(/\/+$/, "");
      const res = await authFetch(`${base}/api/users/${userId}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Failed to load user ${userId} (${res.status})`);
      }
      return normalizeUser<GamevaultUser>(await res.json());
    },
    [serverUrl, authFetch],
  );

  useEffect(() => {
    let cancelled = false;

    if (!serverUrl) {
      setUsers([]);
      setDetailsById({});
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
        const rawUsers: GamevaultUser[] = await res.json();
        if (cancelled) return;

        const activeUsers = rawUsers
          .map((entry) => normalizeUser(entry))
          .filter((entry) => !entry.deleted_at)
          .sort((left, right) => {
            if (left.id === currentUserId) return -1;
            if (right.id === currentUserId) return 1;
            return getDisplayName(left).localeCompare(getDisplayName(right));
          });

        setUsers(activeUsers);
      } catch (fetchError: any) {
        if (!cancelled) {
          setError(fetchError?.message || "Failed to load community network");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, currentUserId]);

  useEffect(() => {
    let cancelled = false;

    const missingIds = users
      .map((entry) => entry.id)
      .filter((userId) => !detailsById[userId]);

    if (!missingIds.length) return;

    (async () => {
      setLoadingDetails(true);
      const results = await Promise.allSettled(
        missingIds.map((userId) => fetchUserDetail(userId)),
      );
      if (cancelled) return;

      setDetailsById((previous) => {
        const next = { ...previous };
        for (const result of results) {
          if (result.status === "fulfilled" && result.value?.id) {
            next[result.value.id] = result.value;
          }
        }
        return next;
      });
      setLoadingDetails(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [users, detailsById, fetchUserDetail]);

  const members = useMemo(
    () =>
      users
        .map((entry) => detailsById[entry.id] || entry)
        .sort((left, right) => {
          if (left.id === currentUserId) return -1;
          if (right.id === currentUserId) return 1;
          const leftRecent = toTimestamp(getUserStats(left).lastPlayed);
          const rightRecent = toTimestamp(getUserStats(right).lastPlayed);
          if (leftRecent !== rightRecent) return rightRecent - leftRecent;
          return getDisplayName(left).localeCompare(getDisplayName(right));
        }),
    [users, detailsById, currentUserId],
  );

  const filteredMembers = useMemo(() => {
    if (!userSearch.trim()) return members;
    const q = userSearch.toLowerCase();
    return members.filter((m) => {
      const name = getDisplayName(m).toLowerCase();
      const handle = getUserHandle(m).toLowerCase();
      return name.includes(q) || handle.includes(q);
    });
  }, [members, userSearch]);

  const networkStats = useMemo(() => {
    const totalMinutes = members.reduce(
      (sum, member) => sum + getUserStats(member).totalMinutes,
      0,
    );
    const recentlyActiveMembers = members.filter(
      (member) => toTimestamp(getUserStats(member).lastPlayed) >= recentCutoff,
    ).length;

    return {
      members: members.length,
      recentlyActiveMembers,
      totalMinutes,
    };
  }, [members, recentCutoff]);

  if (!serverUrl) {
    return (
      <div className="flex min-h-full flex-col gap-4">
        <Heading>Community</Heading>
        <Divider className="border-gv-line/80" />
        <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
          Connect to a server to browse the network.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <Heading>Community</Heading>
          <Text className="max-w-2xl">
            Discover who's playing in your vault and explore their game libraries.
          </Text>
        </div>
        <div className="flex flex-wrap gap-3">
          <span className="data-chip">
            <strong data-numeric>{networkStats.members}</strong>
            Members
          </span>
          <span className="data-chip">
            <strong data-numeric>{networkStats.recentlyActiveMembers}</strong>
            Active in 2 weeks
          </span>
          <span className="data-chip">
            <strong>{formatPlaytime(networkStats.totalMinutes)}</strong>
            Logged time
          </span>
        </div>
      </div>
      <Divider className="border-gv-line/80" />

      <div className="w-full max-w-sm">
        <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
          Search members
        </label>
        <Input
          name="userSearch"
          value={userSearch}
          onChange={(e: any) => setUserSearch(e.target.value)}
          placeholder="Filter by name or handle..."
          clearable
          onClear={() => setUserSearch("")}
        />
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="surface-panel h-96 animate-pulse rounded-[1.75rem]"
            />
          ))}
        </div>
      ) : filteredMembers.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {filteredMembers.map((member) => (
            <NetworkUserCard
              key={member.id}
              user={member}
              isCurrentUser={member.id === currentUserId}
            />
          ))}
        </div>
      ) : (
        <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
          {userSearch.trim() ? "No members match your search." : "No community members found yet."}
        </div>
      )}

      {loadingDetails && filteredMembers.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gv-muted">
          <svg className="h-4 w-4 motion-safe:animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Refreshing player activity…
        </div>
      )}
    </div>
  );
}