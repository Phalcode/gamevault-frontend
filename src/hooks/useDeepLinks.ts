import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { parseDeepLink } from "@/utils/deepLink";
import { launchInstalledGameById } from "@/utils/launchInstalledGame";
import {
  consumePendingDeepLink,
  setPendingDeepLink,
} from "@/utils/pendingRoute";
import { isTauriDesktop } from "@/utils/tauri";
import { trackEvent } from "@/utils/analytics";

/**
 * Handles `gamevault://` links for the desktop app.
 *
 * Two delivery paths, because the OS starts the app differently depending on
 * whether it is already running:
 *
 * - **Cold start / second instance**: the URL is a command line argument. The
 *   Rust side (deep-link + single-instance plugins) turns it into a
 *   `deep-link://new-url` event; a URL that arrived before the webview existed
 *   is read with `getCurrent()`.
 * - **Running app**: `onOpenUrl` fires while the window is open.
 *
 * Links received before the session is restored are parked (see
 * `pendingRoute`) and applied once the user is authenticated.
 */

/** URLs that started this webview session, so a reload does not re-open them. */
const SEEN_URLS_KEY = "gv_deeplink_seen";
const SEEN_URLS_LIMIT = 20;

/** Same URL reported by `getCurrent` and `onOpenUrl` back to back. */
const DUPLICATE_WINDOW_MS = 1_000;

let lastHandled: { url: string; at: number } | null = null;

/**
 * Command of a link we could not parse, for the `deep_link_invalid` event.
 * Only the command is reported, never the URL or the game id.
 */
function deepLinkKind(raw: string): string {
  const match = /^gamevault:\/\/?([a-z]+)/i.exec(raw.trim());
  return match ? match[1].toLowerCase() : "unknown";
}

/** Records a URL from `getCurrent`; returns true when it was already handled. */
function markSeen(url: string): boolean {
  try {
    const raw = sessionStorage.getItem(SEEN_URLS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const seen = Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];

    if (seen.includes(url)) return true;

    seen.push(url);
    sessionStorage.setItem(
      SEEN_URLS_KEY,
      JSON.stringify(seen.slice(-SEEN_URLS_LIMIT)),
    );
    return false;
  } catch {
    return false;
  }
}

export function useDeepLinks(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, bootstrapping } = useAuth();
  const [urls, setUrls] = useState<string[]>([]);

  const enqueue = useCallback(
    (incoming: readonly string[], fromInitialRead: boolean) => {
      const fresh = fromInitialRead
        ? incoming.filter((url) => !markSeen(url))
        : [...incoming];
      if (fresh.length === 0) return;
      setUrls((previous) => [...previous, ...fresh]);
    },
    [],
  );

  // Subscribe to links; read the one that started the app, if any.
  useEffect(() => {
    if (!isTauriDesktop()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      let deepLink: typeof import("@tauri-apps/plugin-deep-link");
      try {
        deepLink = await import("@tauri-apps/plugin-deep-link");
      } catch (error) {
        console.warn("Deep link plugin unavailable:", error);
        return;
      }

      try {
        // A link that started the app is emitted before the webview exists,
        // so the event is gone by now — read the stored value instead.
        const current = await deepLink.getCurrent();
        if (!disposed && current?.length) enqueue(current, true);
      } catch (error) {
        console.warn(
          "Failed to read the deep link that started the app:",
          error,
        );
      }

      try {
        const stop = await deepLink.onOpenUrl((incoming) =>
          enqueue(incoming, false),
        );
        if (disposed) stop();
        else unlisten = stop;
      } catch (error) {
        console.warn("Failed to subscribe to deep links:", error);
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enqueue]);

  // Apply links in order once the session state is known.
  useEffect(() => {
    if (bootstrapping || urls.length === 0) return;

    const [next, ...rest] = urls;
    setUrls(rest);

    const action = parseDeepLink(next);
    if (!action) {
      // Unknown command or malformed id: ignore it, keep the current screen.
      console.warn("Ignoring unsupported deep link:", next);
      trackEvent("deep_link_invalid", { path: deepLinkKind(next) });
      return;
    }
    trackEvent("deep_link_received", {
      kind: action.kind,
      authenticated: Boolean(auth),
    });

    if (!auth) {
      // Sign-in required: remember the action instead of dropping it. The
      // bootstrapping/location effects below apply it after login.
      setPendingDeepLink(action);
      return;
    }

    if (action.kind === "start") {
      // Launches the installed game (or does nothing); never navigates.
      void launchInstalledGameById(action.gameId);
      return;
    }

    const now = Date.now();
    if (
      lastHandled?.url === next &&
      now - lastHandled.at < DUPLICATE_WINDOW_MS
    ) {
      return;
    }
    lastHandled = { url: next, at: now };

    // Do not stack duplicate history entries for the page already shown.
    if (location.pathname === action.route) return;

    navigate(action.route, {
      // At the login screen the entry is replaced so Back does not return to
      // the login form; everywhere else a normal push keeps Back working.
      replace: location.pathname === "/",
      state: { fromDeepLink: true },
    });
  }, [auth, bootstrapping, urls, location.pathname, navigate]);

  // Apply a link that was parked before login.
  useEffect(() => {
    if (bootstrapping || !auth) return;
    // Stay put while the login screen is still the current page: `Login` and
    // `RedirectIfAuth` navigate to /library right after authentication and
    // would otherwise overwrite the deep link target.
    if (location.pathname === "/") return;

    const action = consumePendingDeepLink();
    if (!action) return;

    if (action.kind === "start") {
      void launchInstalledGameById(action.gameId);
      return;
    }

    if (location.pathname === action.route) return;

    navigate(action.route, { state: { fromDeepLink: true } });
  }, [auth, bootstrapping, location.pathname, navigate]);
}
