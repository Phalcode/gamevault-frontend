import { Badge } from "@/components/tailwind/badge";
import { Button } from "@/components/tailwind/button";
import { Divider } from "@tw/divider";
import { Heading, Subheading } from "@tw/heading";
import { Input } from "@tw/input";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { Text } from "@tw/text";
import { UserAvatar } from "@/components/UserAvatar";
import { Media } from "@/components/Media";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import BackButton from "@/components/BackButton";
import { UserEditorModal } from "@/components/admin/UserEditorModal";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useAuthMediaUrl } from "@/hooks/useAuthMediaUrl";
import { getGameCoverMediaId } from "@/hooks/useGames";
import { getRoleLabel } from "@/utils/roles";
import { GamevaultUserRoleEnum } from "@/api";
import clsx from "clsx";
import {
  BookmarkIcon,
  CheckCircleIcon,
  ClockIcon,
  PencilSquareIcon,
  PlayCircleIcon,
  SparklesIcon,
  TrashIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { GamevaultGame, GamevaultUser, Progress } from "../api";

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
  ABORTED_TEMPORARY: {
    label: "On hold",
    tone: "text-amber-400",
    chip: "amber",
  },
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

function formatFullDateTime(value: unknown): string | null {
  const timestamp = toTimestamp(value);
  if (timestamp === -Infinity) return null;
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return null;
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

function getRecentProgresses(
  user: GamevaultUser | null | undefined,
  limit = 6,
) {
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
    (progress) => progress.state === "PLAYING" || progress.state === "INFINITE",
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
  return (
    PROGRESS_STATE_META[state || "UNPLAYED"] || PROGRESS_STATE_META.UNPLAYED
  );
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
          gameId={game?.id}
          mediaSlot="cover"
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

function ProfileProgressCard({
  progress,
  onDelete,
}: {
  progress: Progress;
  onDelete?: (progressId: number, gameId: number) => void;
}) {
  const game = progress.game;
  const title = game?.metadata?.title || game?.title || "Unknown Game";
  const meta = getProgressMeta(progress.state);
  return (
    <Link
      to={game?.id ? `/library/${game.id}` : "/library"}
      className="group relative block rounded-3xl focus:outline-none focus:ring-2 focus:ring-gv-accent-cool"
    >
      <article className="surface-panel h-full rounded-3xl p-4 transition-[transform,translate,scale,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-(--shadow-shell)">
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
            <div className="mt-3 min-w-0 space-y-2 text-sm text-gv-muted">
              <div className="flex min-w-0 items-center gap-2">
                <ClockIcon className="size-4 shrink-0 text-gv-accent-cool" />
                <span className="truncate">
                  {formatPlaytime(Number(progress.minutes_played ?? 0) || 0)}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <SparklesIcon className="size-4 shrink-0 text-gv-accent-cool" />
                <span
                  className="truncate"
                  title={
                    formatFullDateTime(progress.last_played_at) ?? undefined
                  }
                >
                  Last played {formatDate(progress.last_played_at)}
                </span>
              </div>
            </div>
          </div>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const gid = (progress.game as any)?.id ?? (game as any)?.id ?? 0;
              onDelete(progress.id, gid);
            }}
            className="absolute bottom-3 right-3 rounded-xl p-2 text-gv-muted hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
            aria-label="Delete progress entry"
            title="Delete progress entry"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </article>
    </Link>
  );
}

export default function UserProfile() {
  const { serverUrl, authFetch, user: loggedIn } = useAuth();
  const { showAlert } = useAlertDialog();
  const { id } = useParams<{ id?: string }>();

  const [user, setUser] = useState<GamevaultUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [progressSearch, setProgressSearch] = useState("");
  const [progressFilter, setProgressFilter] = useState<string>("all");
  const [progressSort, setProgressSort] = useState<ProfileProgressSort>("last");

  const userId = id ? Number(id) : null;
  const currentUserId = (loggedIn as any)?.id ?? (loggedIn as any)?.ID ?? null;
  const currentUserRole = Number((loggedIn as any)?.role ?? 0);
  const isOwnProfile = userId === currentUserId;
  const isAdmin = currentUserRole >= Number(GamevaultUserRoleEnum._3);
  const canEdit = isOwnProfile || isAdmin;

  const recentCutoff = useMemo(() => Date.now() - TWO_WEEKS_MS, []);

  useEffect(() => {
    if (!serverUrl || !userId || Number.isNaN(userId)) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/users/${userId}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`Failed to load user (${res.status})`);
        const json = await res.json();
        if (!cancelled) setUser(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load user profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, userId]);

  const stats = useMemo(() => getUserStats(user), [user]);
  const recent = useMemo(
    () => getRecentWindowProgresses(user, recentCutoff).slice(0, 8),
    [user, recentCutoff],
  );
  const bookmarks = useMemo(() => getBookmarkedGames(user).slice(0, 8), [user]);
  const allProgresses = useMemo(() => {
    const query = progressSearch.trim().toLowerCase();
    return getProgresses(user)
      .filter((progress) => {
        const title =
          progress.game?.metadata?.title ||
          progress.game?.title ||
          "Unknown Game";
        const matchesQuery = !query || title.toLowerCase().includes(query);
        const matchesState =
          progressFilter === "all" || progress.state === progressFilter;
        return matchesQuery && matchesState;
      })
      .sort((left, right) => {
        if (progressSort === "time") {
          return (
            Number(right.minutes_played ?? 0) - Number(left.minutes_played ?? 0)
          );
        }
        if (progressSort === "title") {
          const leftTitle =
            left.game?.metadata?.title || left.game?.title || "Unknown Game";
          const rightTitle =
            right.game?.metadata?.title || right.game?.title || "Unknown Game";
          return leftTitle.localeCompare(rightTitle);
        }
        if (progressSort === "state") {
          return getProgressMeta(left.state).label.localeCompare(
            getProgressMeta(right.state).label,
          );
        }
        return (
          toTimestamp(right.last_played_at) - toTimestamp(left.last_played_at)
        );
      });
  }, [user, progressSearch, progressFilter, progressSort]);

  const { url: backdropUrl } = useAuthMediaUrl(getPrimaryBackdropMediaId(user));

  useEffect(() => {
    setProgressSearch("");
    setProgressFilter("all");
    setProgressSort("last");
  }, [userId]);

  const handleDeleteProgress = useCallback(
    async (progressId: number, gameId: number) => {
      if (!serverUrl || !userId || !gameId) return;

      const confirmed = await showAlert({
        title: "Delete progress entry?",
        description:
          "This will permanently remove the playtime, state, and history for this game. This action cannot be undone.",
        affirmativeText: "Delete",
        negativeText: "Cancel",
      });

      if (!confirmed) return;

      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(
          `${base}/api/progresses/user/${userId}/game/${gameId}`,
          { method: "DELETE" },
        );
        if (!res.ok && res.status !== 204) {
          throw new Error(`Delete failed (${res.status})`);
        }
        // Remove from local state
        setUser((prev) =>
          prev
            ? {
                ...prev,
                progresses: prev.progresses?.filter((p) => p.id !== progressId),
              }
            : prev,
        );
      } catch (err: any) {
        console.error("Failed to delete progress:", err);
        showAlert({
          title: "Failed to delete progress",
          description: err?.message || "An unknown error occurred.",
        });
      }
    },
    [serverUrl, userId, authFetch, showAlert],
  );

  if (!serverUrl) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <Heading>Community</Heading>
        <Divider className="border-gv-line/80" />
        <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
          Connect to a server to browse the network.
        </div>
      </div>
    );
  }

  if (!userId || Number.isNaN(userId)) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <div className="flex flex-col gap-4">
          <BackButton />
          <Heading>Community</Heading>
        </div>
        <Divider className="border-gv-line/80" />
        <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
          Invalid user ID.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <div className="flex flex-col gap-4">
          <BackButton />
          <Heading>Community</Heading>
        </div>
        <Divider className="border-gv-line/80" />
        <div className="surface-panel h-96 animate-pulse rounded-[1.75rem]" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-full flex-col gap-6">
        <div className="flex flex-col gap-4">
          <BackButton />
          <Heading>Community</Heading>
        </div>
        <Divider className="border-gv-line/80" />
        <div className="surface-panel-soft rounded-3xl p-8 text-sm text-gv-muted">
          {error || "User not found in this network."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-6 overflow-x-hidden">
      <div className="flex flex-col gap-4">
        <BackButton />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <Heading>Community</Heading>
            <Text>
              Browse player profiles, stats, and shared library history.
            </Text>
          </div>
          {canEdit && (
            <Button outline onClick={() => setShowEditProfile(true)}>
              <PencilSquareIcon className="size-4" />
              Edit profile
            </Button>
          )}
        </div>
      </div>
      <Divider className="border-gv-line/80" />

      <section className="surface-panel relative min-h-80 overflow-hidden rounded-4xl">
        <div className="absolute inset-0">
          {backdropUrl ? (
            <>
              <img
                src={backdropUrl}
                alt=""
                className="h-full w-full scale-105 object-cover opacity-42"
              />
              <img
                src={backdropUrl}
                alt=""
                className="absolute inset-[-8%] h-[116%] w-[116%] object-cover opacity-34 blur-3xl"
              />
            </>
          ) : (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(132,123,237,0.3),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(244,63,94,0.18),transparent_45%),linear-gradient(135deg,rgba(84,73,198,0.18),transparent_60%)]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,10,20,0.08),rgba(10,10,20,0.78))]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(132,123,237,0.18),transparent_42%)]" />
        </div>

        <div className="relative flex min-h-80 flex-col justify-end gap-6 p-6 sm:p-7 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-end gap-4">
              <UserAvatar
                media={user.avatar}
                size={110}
                alt={getDisplayName(user)}
                fallback={getAvatarFallback(user)}
                className="border-4 border-white/20 bg-gv-panel-soft/50 shadow-lg backdrop-blur-xl"
              />
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={getRoleBadgeColor(user.role)}>
                    {getRoleLabel(Number(user.role))}
                  </Badge>
                  {isOwnProfile && <Badge color="indigo">Your profile</Badge>}
                  {!user.activated && <Badge color="rose">Inactive</Badge>}
                </div>
                <div>
                  <h2 className="truncate text-3xl font-bold tracking-[-0.04em] text-white">
                    {getDisplayName(user)}
                  </h2>
                  <p className="mt-1 text-base text-white/80">
                    @{getUserHandle(user)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-white/80">
                  <span
                    title={formatFullDateTime(user.created_at) ?? undefined}
                  >
                    Joined {formatDate(user.created_at, "Unknown")}
                  </span>
                  <span
                    title={formatFullDateTime(stats.lastPlayed) ?? undefined}
                  >
                    Last seen {formatDate(stats.lastPlayed, "Never")}
                  </span>
                  <span>{formatPlaytime(stats.totalMinutes)} logged</span>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { icon: UserGroupIcon, label: "Tracked", value: stats.tracked },
                {
                  icon: PlayCircleIcon,
                  label: "Playing",
                  value: stats.playing,
                },
                {
                  icon: CheckCircleIcon,
                  label: "Finished",
                  value: stats.completed,
                },
                {
                  icon: BookmarkIcon,
                  label: "Bookmarks",
                  value: stats.bookmarks,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[1.25rem] border border-white/12 bg-white/10 px-4 py-3 text-white backdrop-blur-xl"
                >
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-white/70">
                    <item.icon className="size-4" />
                    {item.label}
                  </div>
                  <div className="mt-3 text-2xl font-semibold" data-numeric>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-6">
        <section className="surface-panel rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Subheading>Recent activity</Subheading>
              <Text>Games touched in the last 2 weeks.</Text>
            </div>
            <Badge color="zinc" className="shrink-0 whitespace-nowrap">
              {recent.length} in 2 weeks
            </Badge>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {recent.length > 0 ? (
              recent.map((progress) => (
                <ProfileProgressCard key={progress.id} progress={progress} />
              ))
            ) : (
              <div className="surface-panel-soft rounded-3xl p-6 text-sm text-gv-muted">
                No recent activity in the last 2 weeks.
              </div>
            )}
          </div>
        </section>

        <section className="surface-panel rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Subheading>All game progress</Subheading>
              <Text>
                Filter the full history to inspect paused, dropped, finished, or
                untouched games.
              </Text>
            </div>
            <Badge color="zinc" className="shrink-0 whitespace-nowrap">
              {allProgresses.length} matches
            </Badge>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px] lg:items-end">
            <div className="w-full">
              <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                Search games
              </label>
              <Input
                name="progressSearch"
                value={progressSearch}
                onChange={(event: any) => setProgressSearch(event.target.value)}
                placeholder="Find a game in this profile..."
                clearable
                onClear={() => setProgressSearch("")}
              />
            </div>
            <div>
              <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                Filter by state
              </label>
              <Listbox
                name="progressFilter"
                value={progressFilter}
                onChange={(value: any) => setProgressFilter(String(value))}
              >
                {PROFILE_FILTER_OPTIONS.map((option) => (
                  <ListboxOption key={option.value} value={option.value}>
                    <ListboxLabel>{option.label}</ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
            </div>
            <div>
              <label className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-gv-muted">
                Sort by
              </label>
              <Listbox
                name="progressSort"
                value={progressSort}
                onChange={(value: any) =>
                  setProgressSort(value as ProfileProgressSort)
                }
              >
                {PROFILE_SORT_OPTIONS.map((option) => (
                  <ListboxOption key={option.value} value={option.value}>
                    <ListboxLabel>{option.label}</ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
            </div>
          </div>
          <div className="mt-5 overflow-x-hidden md:max-h-168 md:overflow-y-auto grid gap-4 md:grid-cols-2">
            {allProgresses.length > 0 ? (
              allProgresses.map((progress, i) => (
                <div
                  key={`all-${progress.id}`}
                  className="animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none"
                  style={{ animationDelay: `${Math.min(i * 0.04, 0.3)}s` }}
                >
                  <ProfileProgressCard
                    progress={progress}
                    onDelete={isOwnProfile ? handleDeleteProgress : undefined}
                  />
                </div>
              ))
            ) : (
              <div className="surface-panel-soft rounded-3xl p-6 text-sm text-gv-muted md:col-span-2">
                No games match this filter combination.
              </div>
            )}
          </div>
        </section>

        <section className="surface-panel rounded-[1.75rem] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Subheading>Bookmarked shelf</Subheading>
              <Text>Games this player pinned for later.</Text>
            </div>
            <Badge color="zinc" className="shrink-0 whitespace-nowrap">
              {bookmarks.length} saved
            </Badge>
          </div>
          <div className="mt-5 flex gap-4 overflow-x-auto pb-2">
            {bookmarks.length > 0 ? (
              bookmarks.map((game) => {
                const title = game.metadata?.title || game.title || "Game";
                return (
                  <Link
                    key={game.id}
                    to={`/library/${game.id}`}
                    className="group block w-37.5 shrink-0 rounded-3xl focus:outline-none focus:ring-2 focus:ring-gv-accent-cool"
                  >
                    <div className="surface-panel rounded-3xl p-3 transition-[transform,translate,scale,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-(--shadow-shell)">
                      <GamePoster
                        game={game}
                        title={title}
                        width={126}
                        height={170}
                      />
                      <div className="mt-3 line-clamp-2 text-sm font-medium text-gv-text">
                        {title}
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="surface-panel-soft rounded-3xl p-6 text-sm text-gv-muted">
                No bookmarks shared yet.
              </div>
            )}
          </div>
        </section>
      </div>

      {showEditProfile && user && (
        <UserEditorModal
          key={user.id}
          user={user}
          onClose={() => setShowEditProfile(false)}
          onUserUpdated={(updatedUser: GamevaultUser) => {
            setUser(updatedUser);
            setShowEditProfile(false);
          }}
          self={isOwnProfile}
        />
      )}
    </div>
  );
}
