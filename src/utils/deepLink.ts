/**
 * Custom URI scheme handled by the desktop client.
 *
 * Registered in `src-tauri/tauri.conf.json > plugins.deep-link` so the
 * installers (Windows NSIS, Linux .desktop, macOS Info.plist) associate
 * `gamevault://` links with the app.
 */
export const DEEP_LINK_SCHEME = "gamevault";

const GAME_ROUTE_PREFIX = "/library";

/** Something a `gamevault://` link asks the app to do. */
export type DeepLinkAction =
  { kind: "show"; route: string } | { kind: "start"; gameId: number };

/**
 * Translates a `gamevault://` URL into the action it should perform.
 *
 * Supported shapes (the command is the URL host because custom schemes have
 * no standard path; the path form `gamevault:///show?gameid=123` is accepted
 * too, since some link producers emit it):
 *
 *     gamevault://show?gameid=123   ->  open /library/123
 *     gamevault://start?gameid=123  ->  launch the installed game
 *
 * Returns `null` for anything we do not handle (wrong scheme, unknown
 * command, missing or invalid id) so callers can ignore it silently.
 */
export function parseDeepLink(raw: string): DeepLinkAction | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;

  const command = commandOf(url);
  switch (command) {
    case "show": {
      const gameId = parseGameId(url.searchParams);
      return gameId === null
        ? null
        : { kind: "show", route: `${GAME_ROUTE_PREFIX}/${gameId}` };
    }
    case "start": {
      const gameId = parseGameId(url.searchParams);
      return gameId === null ? null : { kind: "start", gameId };
    }
    default:
      return null;
  }
}

/** Shape check for actions read back from storage. */
export function isDeepLinkAction(value: unknown): value is DeepLinkAction {
  if (!value || typeof value !== "object") return false;

  const action = value as {
    kind?: unknown;
    route?: unknown;
    gameId?: unknown;
  };
  switch (action.kind) {
    case "show":
      return isInternalRoute(action.route);
    case "start":
      return isPositiveGameId(action.gameId);
    default:
      return false;
  }
}

/** Command segment of the URL: the host, or the first path segment as fallback. */
function commandOf(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (host) return host;
  return url.pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")[0]
    .toLowerCase();
}

/** Positive, safe integer game id from `gameid` (or the legacy `gameID`). */
function parseGameId(params: URLSearchParams): number | null {
  const raw = params.get("gameid") ?? params.get("gameID");
  if (raw === null) return null;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const id = Number(trimmed);
  return isPositiveGameId(id) ? id : null;
}

/** Only internal, absolute paths: a link must never redirect off-origin. */
function isInternalRoute(route: unknown): route is string {
  return (
    typeof route === "string" &&
    route.startsWith("/") &&
    !route.startsWith("//")
  );
}

function isPositiveGameId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
