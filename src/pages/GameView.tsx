import { useParams } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";
import { Heading, Subheading } from "@tw/heading";
import { Divider } from "@tw/divider";
import { Media } from "@/components/Media";
import { Button } from "@tw/button";
import { GamevaultGame } from "@/api/models/GamevaultGame";


export default function GameView() {
  const { id } = useParams<{ id: string }>();
  const numericId = Number(id);
  const { serverUrl, authFetch } = useAuth();
  const [game, setGame] = useState<GamevaultGame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!serverUrl || !numericId || Number.isNaN(numericId)) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/games/${numericId}`, { method: 'GET' });
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        const json = await res.json();
        if (!cancelled) setGame(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load game');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [serverUrl, authFetch, numericId]);

  const coverId = (game?.metadata as any)?.cover?.id;
  const title = game?.metadata?.title || game?.title;
  const description = (game as any)?.metadata?.description || null;

  return (
    <div className="flex flex-col h-full overflow-auto pb-12">
      <Heading>{title}</Heading>
      <Divider />
      {loading && (
        <div className="p-6 text-sm text-fg-muted">Loading game…</div>
      )}
      {error && (
        <div className="p-6 text-sm text-red-500 bg-red-500/10 rounded-md max-w-xl">{error}</div>
      )}
      {!loading && !error && game && (
        <div className="p-2 max-w-4xl space-y-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-56 md:w-64 shrink-0">
              {coverId ? (
                <Media media={{ id: coverId } as any} size={256} className="w-full aspect-[3/4]" square alt={title} />
              ) : (
                <div className="w-full aspect-[3/4] flex items-center justify-center rounded-xl bg-zinc-200 dark:bg-zinc-800 text-xs text-fg-muted">No Cover</div>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-4">
              <Subheading level={2}>Description</Subheading>
              {description ? (
                <p className="text-sm leading-relaxed whitespace-pre-line text-fg-muted">{description}</p>
              ) : (
                <p className="text-sm italic text-fg-muted/70">No description available.</p>
              )}
              <div>
                <Button color="indigo" onClick={() => window.history.back()} className="mt-2">Back</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
