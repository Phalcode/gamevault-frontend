import { GamevaultGame } from "@/api/models/GamevaultGame";
import { Progress, ProgressStateEnum } from "@/api/models/Progress";
import { Media } from "@/components/Media";
import MediaSlider from "@/components/MediaSlider";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@tw/button";
import { Listbox, ListboxOption, ListboxLabel } from "@tw/listbox";
import Card from "@/components/Card";
import { useDownloads } from "@/context/DownloadContext";
import { useEffect, useMemo, useState, useCallback, useRef, useLayoutEffect } from "react";
import { useParams } from "react-router";
import { CloudArrowDownIcon, Cog8ToothIcon, ShareIcon, StarIcon as StarSolid, WrenchScrewdriverIcon, BuildingOffice2Icon, ShieldCheckIcon } from "@heroicons/react/24/solid";
import { StarIcon as StarOutline, CalendarDaysIcon, GlobeAltIcon, HashtagIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import Markdown from "react-markdown";
import { Dropdown, DropdownButton, DropdownItem, DropdownLabel, DropdownMenu } from "@tw/dropdown";
import { Alert, AlertTitle } from "@tw/alert";
import { GameSettings } from "@/components/admin/GameSettings";

export default function GameView() {
  const { id } = useParams<{ id: string }>();
  const numericId = Number(id);
  const { serverUrl, authFetch, user } = useAuth();
  const [game, setGame] = useState<GamevaultGame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const { startDownload } = useDownloads() as any;
  const [progressState, setProgressState] = useState<keyof typeof ProgressStateEnum | null>(null);
  const [progressUpdating, setProgressUpdating] = useState(false);
  const insertedPlaceholderRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!serverUrl || !numericId || Number.isNaN(numericId)) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/games/${numericId}`, {
          method: "GET",
        });
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        const json = await res.json();
        if (!cancelled) setGame(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load game");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, numericId]);

  const coverId = game?.metadata?.cover?.id;
  const trailers = [
    ...(game?.metadata?.url_trailers || []),
    ...(game as any)?.metadata?.url_gameplays || [],
  ];
  const screenshots = game?.metadata?.url_screenshots || [];
  const title = game?.metadata?.title || game?.title;
  const description = game?.metadata?.description || null;
  const notes = (game as any)?.metadata?.notes || "";
  // Tags now sourced from metadata.tags (array of objects with name)
  const tags: string[] = ((game as any)?.metadata?.tags || []).map((t: any) => t?.name).filter((n: any) => typeof n === 'string' && n.trim());
  const [detailsTab, setDetailsTab] = useState<'description' | 'notes' | 'tags'>('description');
  const mediaSliderRef = useRef<HTMLDivElement | null>(null);
  const detailsCardRef = useRef<HTMLDivElement | null>(null);
  const [mediaHeight, setMediaHeight] = useState<number | null>(null);
  const [detailsHeight, setDetailsHeight] = useState<number | null>(null);
  const [isXL, setIsXL] = useState<boolean>(() => typeof window !== 'undefined' ? window.matchMedia('(min-width: 1280px)').matches : false);

  const recomputeHeights = useCallback(() => {
    // Only sync heights on xl and above; on smaller screens allow natural height flow to avoid overlap
    const xl = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1280px)').matches : false;
    setIsXL(xl);
    if (xl) {
      if (mediaSliderRef.current) setMediaHeight(mediaSliderRef.current.offsetHeight);
      if (detailsCardRef.current) setDetailsHeight(detailsCardRef.current.offsetHeight);
    } else {
      setMediaHeight(null);
      setDetailsHeight(null);
    }
  }, []);

  useLayoutEffect(() => {
    recomputeHeights();
  }, [game, trailers.length, screenshots.length, description, notes, tags, detailsTab, recomputeHeights]);

  useEffect(() => {
    window.addEventListener('resize', recomputeHeights);
    // Initial measure
    recomputeHeights();
    return () => window.removeEventListener('resize', recomputeHeights);
  }, [recomputeHeights]);
  const rawGenres = (game as any)?.metadata?.genres || [];
  const genres: string[] = Array.isArray(rawGenres)
    ? rawGenres.map((g: any) => (typeof g === "string" ? g : g?.name)).filter((g: any) => typeof g === "string" && g.trim())
    : [];

  const currentUserId = (user as any)?.id ?? (user as any)?.ID;

  // Derive current user's progress among progresses
  const userProgress: Progress | null = useMemo(() => {
    if (!game || !Array.isArray((game as any).progresses) || !currentUserId) return null;
    return (game as any).progresses.find((p: any) => (p.user?.id ?? p.user?.ID) === currentUserId) || null;
  }, [game, currentUserId]);

  // Inject placeholder progress if none exists for the current user
  useEffect(() => {
    if (!game || !currentUserId || insertedPlaceholderRef.current) return;
    const progresses: Progress[] | undefined = (game as any).progresses;
    const exists = Array.isArray(progresses) && progresses.some(p => (p.user as any)?.id === currentUserId || (p.user as any)?.ID === currentUserId);
    if (!exists) {
      const placeholder: Progress = {
        id: -currentUserId, // temporary local id
        created_at: new Date(),
        updated_at: undefined,
        deleted_at: undefined,
        entity_version: 0,
        user: { id: currentUserId } as any,
        game: { id: game.id } as any,
        minutes_played: 0,
        state: ProgressStateEnum.unplayed,
        last_played_at: undefined,
      } as any;
      setGame(prev => prev ? ({ ...prev, progresses: [ ...(prev as any).progresses || [], placeholder ] }) : prev);
      if (!progressState) setProgressState('unplayed');
      insertedPlaceholderRef.current = true;
    }
  }, [game, currentUserId, progressState]);

  useEffect(() => {
    if (userProgress?.state) {
      // Map to key form matching ProgressStateEnum keys
      const val = Object.entries(ProgressStateEnum).find(([, v]) => v === userProgress.state)?.[0] as keyof typeof ProgressStateEnum | undefined;
      if (val) setProgressState(val);
    }
  }, [userProgress]);

  // Bookmark detection
  useEffect(() => {
    if (!game || !currentUserId) return;
    const arr = (game as any).bookmarked_users || (game as any).bookmarkedUsers || [];
    setBookmarked(Array.isArray(arr) && arr.some((u: any) => (u?.id ?? u?.ID) === currentUserId));
  }, [game, currentUserId]);

  const toggleBookmark = useCallback(async () => {
    if (!serverUrl || !game || !currentUserId || bookmarkBusy) return;
    setBookmarkBusy(true);
    const base = serverUrl.replace(/\/+$/, "");
    const next = !bookmarked;
    setBookmarked(next);
    try {
      const url = `${base}/api/users/me/bookmark/${game.id}`;
      const res = await authFetch(url, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error("Bookmark toggle failed");
    } catch {
      setBookmarked(!next);
    } finally {
      setBookmarkBusy(false);
    }
  }, [serverUrl, game, currentUserId, bookmarked, authFetch, bookmarkBusy]);

  const [copiedAlertOpen, setCopiedAlertOpen] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);
  const handleShare = useCallback(() => {
    try { navigator.clipboard.writeText(window.location.href); } catch {}
    // Show ephemeral alert
    setCopiedAlertOpen(true);
    if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current);
    copiedTimeoutRef.current = window.setTimeout(() => setCopiedAlertOpen(false), 1800);
  }, []);
  useEffect(() => () => { if (copiedTimeoutRef.current) window.clearTimeout(copiedTimeoutRef.current); }, []);

  const handleDownload = useCallback(() => {
    if (!game) return;
    // Use id + title for filename
    startDownload(game.id, `${title || game.title}.zip`);
  }, [game, startDownload, title]);

  const PROGRESS_LABEL: Record<string, string> = {
    UNPLAYED: "Unplayed",
    INFINITE: "Infinite",
    PLAYING: "Playing",
    COMPLETED: "Completed",
    ABORTED_TEMPORARY: "Temporarily Aborted",
    ABORTED_PERMANENT: "Permanently Aborted",
  };

  const progressStateOptions = Object.entries(ProgressStateEnum).map(([k, v]) => ({ key: k, value: v, label: PROGRESS_LABEL[v] || v }));

  const updateProgressState = useCallback(async (nextKey: string) => {
    if (!serverUrl || !game || !currentUserId) return;
    const enumVal = (ProgressStateEnum as any)[nextKey];
    if (!enumVal) return;
    setProgressUpdating(true);
    const base = serverUrl.replace(/\/+$/, "");
    try {
      const payload = { state: enumVal };
      const res = await authFetch(`${base}/api/progresses/user/${currentUserId}/game/${game.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // Refresh game data to reflect progress changes
        const updated = await res.json().catch(() => null);
        if (updated && updated.state) {
          // mutate local userProgress optimistic
          setProgressState(nextKey as any);
        }
      }
    } finally {
      setProgressUpdating(false);
    }
  }, [serverUrl, game, currentUserId, authFetch]);

  const playtimeMinutes = userProgress?.minutes_played || 0;
  const playtimeHours = playtimeMinutes / 60;
  const lastPlayed = userProgress?.last_played_at ? new Date(userProgress.last_played_at).toLocaleString() : "—";
  const avgPlaytime = game?.metadata?.average_playtime || (game as any)?.metadata?.average_playtime || null;

  // Derive additional metadata fields
  const releaseYear = game?.release_date ? new Date(game.release_date).getFullYear() : (game as any)?.metadata?.release_year || null;
  const versionTag = game?.version || (game as any)?.metadata?.version || null;
  const websites: string[] = (game as any)?.metadata?.url_websites || [];
  const primaryWebsite = websites.length > 0 ? websites[0] : null;
  const devNames: string[] = ((game as any)?.metadata?.developers || []).map((d: any) => d?.name || d).filter(Boolean);
  const publisherNames: string[] = ((game as any)?.metadata?.publishers || []).map((p: any) => p?.name || p).filter(Boolean);
  const ageRating = (game as any)?.metadata?.age_rating ?? null;
  let rating = (game as any)?.metadata?.rating ?? null; // numeric rating
  const formattedRating = typeof rating === 'number'
    ? (() => {
        const val = rating <= 1 ? Math.round(rating * 100) : Math.round(rating);
        return `${val}%`;
      })()
    : null;

  // Removed h-full overflow-auto to prevent nested scroll area causing double vertical scrollbar; letting parent layout manage vertical scrolling.
  return (
  <div className="flex flex-col pb-12">
      {loading && (
        <div className="p-6 text-sm text-fg-muted">Loading game…</div>
      )}
      {error && (
        <div className="p-6 text-sm text-red-500 bg-red-500/10 rounded-md max-w-xl">
          {error}
        </div>
      )}
      {!loading && !error && game && (
  <div className="px-2 max-w-[1400px] w-full grid xl:grid-cols-[1fr_20rem] gap-10">
          {/* Row 1: Cover/Title/Actions spans both columns on mobile but only left column on xl */}
          <div className="flex flex-row gap-4 items-start xl:col-span-1 xl:row-span-1 min-w-0">
            <div className="w-32 aspect-[3/4] rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500">
              {coverId ? (
                <Media
                  media={game.metadata?.cover}
                  size={180}
                  className="w-full h-full object-contain"
                  square
                  alt={title}
                />
              ) : (
                <span>No Cover</span>
              )}
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-3">
              <div className="text-xl font-semibold leading-tight truncate pr-2">
                {title}
              </div>
              {/* Added flex-wrap to allow buttons to wrap on extremely narrow viewports, preventing horizontal overflow that could push the media slider and cause cutoff */}
              <div className="flex flex-row flex-wrap gap-2">
                <Dropdown>
                  <DropdownButton
                    as={Button}
                    color="indigo"
                    aria-label="Download"
                    className="h-9 w-9 p-0 flex items-center justify-center"
                    title="Download"
                  >
                    <CloudArrowDownIcon className="w-5 h-5" />
                  </DropdownButton>
                  <DropdownMenu className="min-w-48" anchor="bottom start">
                    <DropdownItem onClick={handleDownload}>
                      <DropdownLabel>Direct Download</DropdownLabel>
                    </DropdownItem>
                    <DropdownItem
                      onClick={() => {
                        if (!game) return; window.location.href = `gamevault://install?gameid=${game.id}`;
                      }}
                    >
                      <DropdownLabel>Open in Client</DropdownLabel>
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
                <Button
                  plain
                  onClick={() => setSettingsOpen(true)}
                  className="h-9 w-9 p-0 flex items-center justify-center"
                  title="Settings"
                >
                  <Cog8ToothIcon className="w-5 h-5" />
                </Button>
                <button
                  type="button"
                  onClick={toggleBookmark}
                  disabled={!user || bookmarkBusy}
                  className={clsx(
                    "h-9 w-9 flex items-center justify-center rounded-md border transition-colors backdrop-blur-sm",
                    "disabled:opacity-50 disabled:cursor-not-allowed shadow-sm",
                    bookmarked
                      ? "bg-yellow-400/20 border-yellow-400 text-yellow-400"
                      : "bg-zinc-900/40 dark:bg-zinc-700/50 border-white/20 hover:bg-zinc-800/60 dark:hover:bg-zinc-600/60 text-white"
                  )}
                  title={bookmarked ? "Remove bookmark" : "Add bookmark"}
                  aria-pressed={bookmarked}
                >
                  {bookmarked ? <StarSolid className="w-5 h-5" /> : <StarOutline className="w-5 h-5" />}
                </button>
                <Button
                  plain
                  onClick={handleShare}
                  className="h-9 w-9 p-0 flex items-center justify-center"
                  title="Copy link"
                >
                  <ShareIcon className="w-5 h-5" />
                </Button>
              </div>
              {(genres && genres.length > 0) || game?.type || game?.early_access || (game as any)?.metadata?.early_access ? (
                <div className="flex flex-wrap gap-1 pt-1 items-center">
                  {game?.type && game.type !== 'UNDETECTABLE' && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[10px] font-medium">
                      {game.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  )}
                  {(game as any)?.early_access || (game as any)?.metadata?.early_access ? (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-medium">Early Access</span>
                  ) : null}
                  {genres.map((g: string) => (
                    <span key={g} className="px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-medium text-zinc-700 dark:text-zinc-200">
                      {g}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {/* Spacer so grid second column first row stays empty - ensures metadata card aligns with media slider start */}
            {/* Right Column Row 1: Stats + Progress State */}
            <div className="flex flex-col gap-6 xl:col-start-2 xl:row-start-1 min-w-0">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Playtime</div>
                  <div className="font-semibold text-sm mt-1">{playtimeHours >= 1 ? `${playtimeHours.toFixed(playtimeHours < 10 ? 1 : 0)} h` : `${playtimeMinutes} m`}</div>
                </div>
                <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Last Played</div>
                  <div className="font-semibold text-sm mt-1 truncate" title={lastPlayed}>{lastPlayed}</div>
                </div>
                <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Avg Playtime</div>
                  <div className="font-semibold text-sm mt-1">{avgPlaytime ? `${(avgPlaytime/60).toFixed(avgPlaytime/60 < 10 ? 1 : 0)} h` : "—"}</div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">Progress State</div>
                <Listbox
                  name="progressState"
                  value={progressState || "UNPLAYED"}
                  onChange={(v: any) => updateProgressState(v)}
                  disabled={!user || progressUpdating}
                >
                  {progressStateOptions.map((o) => (
                    <ListboxOption key={o.key} value={o.key}>
                      <ListboxLabel>{o.label}</ListboxLabel>
                    </ListboxOption>
                  ))}
                </Listbox>
              </div>
            </div>

          {/* Row 2 Left: Media Slider + Details */}
          {/* min-w-0 ensures the slider can shrink below intrinsic content width inside CSS grid to avoid right-side cutoff on very small screens */}
          <div className="flex flex-col gap-6 xl:col-start-1 xl:row-start-2 min-w-0">
            {(trailers.length > 0 || screenshots.length > 0) && (
              <div className="w-full min-w-0" ref={mediaSliderRef}>
                <MediaSlider
                  trailers={trailers}
                  screenshots={screenshots}
                  autoPlay={true}
                  loop={false}
                  className="w-full"
                  aspect="aspect-[16/9]"
                />
              </div>
            )}
            <div ref={detailsCardRef} className="contents">
            <Card title="Details" className="!mb-0">
              <div className="flex border-b border-zinc-300/40 dark:border-zinc-700/50 mb-4 gap-6 text-sm">
                <button
                  onClick={() => setDetailsTab('description')}
                  className={clsx('pb-2 -mb-px border-b-2 font-medium', detailsTab === 'description' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200')}
                >Description</button>
                <button
                  onClick={() => setDetailsTab('notes')}
                  className={clsx('pb-2 -mb-px border-b-2 font-medium', detailsTab === 'notes' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200')}
                >Notes</button>
                <button
                  onClick={() => setDetailsTab('tags')}
                  className={clsx('pb-2 -mb-px border-b-2 font-medium', detailsTab === 'tags' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200')}
                >Tags</button>
              </div>
              <div className="text-sm leading-relaxed space-y-4 min-h-[180px]">
                {detailsTab === 'description' && (
                  description ? (
                    <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{description}</p>
                  ) : (
                    <p className="italic text-zinc-500">No description available.</p>
                  )
                )}
                {detailsTab === 'notes' && (
                  notes ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Markdown>{notes}</Markdown>
                    </div>
                  ) : (
                    <p className="italic text-zinc-500">No notes.</p>
                  )
                )}
                {detailsTab === 'tags' && (
                  tags && tags.length ? (
                    <div className="flex flex-wrap gap-2">
                      {tags.map(t => (
                        <span key={t} className="px-2 py-1 rounded-md bg-zinc-200 dark:bg-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200">{t}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="italic text-zinc-500">No tags.</p>
                  )
                )}
              </div>
            </Card>
            </div>
          </div>

          {/* Row 2 Right: Additional Metadata Card aligned with Media Slider top */}
          <div className="flex flex-col gap-6 xl:col-start-2 xl:row-start-2 min-w-0">
            <div className="w-full" style={isXL && mediaHeight ? {height: mediaHeight} : undefined}>
            <Card title="Additional Metadata" className="min-h-[160px] h-full">
              <ul className="space-y-4 text-sm">
                <li className="flex items-start gap-3">
                  <CalendarDaysIcon className="w-5 h-5 mt-0.5 text-zinc-500 dark:text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Release Year</div>
                    <div className="font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap truncate" title={(releaseYear || '—') + ''}>{releaseYear || '—'}</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <StarOutline className="w-5 h-5 mt-0.5 text-zinc-500 dark:text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Rating</div>
                    <div className="font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap" title={formattedRating || '—'}>{formattedRating ?? '—'}</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <HashtagIcon className="w-5 h-5 mt-0.5 text-zinc-500 dark:text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Version</div>
                    <div className="font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap truncate" title={versionTag || '—'}>{versionTag || '—'}</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <GlobeAltIcon className="w-5 h-5 mt-0.5 text-zinc-500 dark:text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Website</div>
                    <div className="font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap truncate" title={primaryWebsite || '—'}>{primaryWebsite ? (
                      <a href={primaryWebsite} target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-600 dark:hover:text-indigo-400">{primaryWebsite.replace(/^https?:\/\//, '')}</a>
                    ) : '—'}</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <WrenchScrewdriverIcon className="w-5 h-5 mt-0.5 text-zinc-500 dark:text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Developer{devNames.length > 1 ? 's' : ''}</div>
                    <div className="font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap truncate" title={devNames.length ? devNames.join(', ') : '—'}>{devNames.length ? devNames.join(', ') : '—'}</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <BuildingOffice2Icon className="w-5 h-5 mt-0.5 text-zinc-500 dark:text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Publisher{publisherNames.length > 1 ? 's' : ''}</div>
                    <div className="font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap truncate" title={publisherNames.length ? publisherNames.join(', ') : '—'}>{publisherNames.length ? publisherNames.join(', ') : '—'}</div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <ShieldCheckIcon className="w-5 h-5 mt-0.5 text-zinc-500 dark:text-zinc-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">Age Rating</div>
                    <div className="font-medium text-zinc-800 dark:text-zinc-100 whitespace-nowrap" title={ageRating ?? '—'}>{ageRating ?? '—'}</div>
                  </div>
                </li>
              </ul>
            </Card>
            </div>
            <div className="w-full" style={isXL && detailsHeight ? {height: detailsHeight} : undefined}>
            <Card title="Activity" className="!mb-0 h-full">
              {(() => {
                const progresses: Progress[] = (game as any)?.progresses || [];
                // Exclude placeholder negative IDs and optionally current user (we show others)
                const others = progresses.filter(p => p.id > 0 && (p.user?.id ?? (p.user as any)?.ID) !== currentUserId);
                if (!others.length) {
                  return <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">No activity from other users.</div>;
                }
                const formatState = (s: string) => s.replace(/_/g,' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
                return (
                  <ul className="flex flex-col gap-3 text-sm">
                    {others.map(p => {
                      const uid = p.user?.id ?? (p.user as any)?.ID;
                      const uname = (p.user as any)?.username || `User #${uid}`;
                      const avatarMedia = (p.user as any)?.avatar;
                      const lastPlayedStr = p.last_played_at ? new Date(p.last_played_at).toLocaleDateString() : '—';
                      const minutes = p.minutes_played || 0;
                      const hours = minutes/60;
                      return (
                        <li key={p.id} className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center text-[10px] text-zinc-600 dark:text-zinc-300">
                            {avatarMedia ? (
                              <Media media={avatarMedia} size={64} className="w-full h-full object-cover" alt={uname} />
                            ) : (
                              uname.slice(0,2).toUpperCase()
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate text-zinc-800 dark:text-zinc-100">{uname}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 font-medium">
                                {formatState(p.state)}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 flex items-center justify-between gap-4 whitespace-nowrap">
                              <span className="truncate">Played: {hours >= 1 ? `${hours.toFixed(hours < 10 ? 1 : 0)} h` : `${minutes} m`}</span>
                              <span className="shrink-0 text-right">Last: {lastPlayedStr}</span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </Card>
            </div>
          </div>
        </div>
      )}
      {/* Ephemeral 'Link copied' alert */}
      <Alert
        open={copiedAlertOpen}
        onClose={(open: boolean) => { if (!open) setCopiedAlertOpen(false); }}
        variant="toast"
        size="xs"
        className="select-none"
      >
        <AlertTitle className="text-sm font-medium">Link copied</AlertTitle>
      </Alert>
      
      {/* Game Settings Modal */}
      {settingsOpen && game && (
        <GameSettings
          game={game}
          onClose={() => setSettingsOpen(false)}
          onGameUpdated={(updatedGame) => setGame(updatedGame)}
        />
      )}
    </div>
  );
}
