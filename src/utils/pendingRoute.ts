import { isDeepLinkAction, type DeepLinkAction } from "@/utils/deepLink";

/**
 * A deep link can arrive before the user is signed in. The action is parked in
 * session storage (not local storage) so it survives a reload or an SSO redirect
 * within the same app session, but not a restart.
 */
const PENDING_ACTION_KEY = "gv_pending_deeplink";

/** Remembers a validated deep link action until the user is authenticated. */
export function setPendingDeepLink(action: DeepLinkAction): void {
  if (!isDeepLinkAction(action)) return;

  try {
    sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(action));
  } catch {
    // Storage unavailable: the link is simply dropped.
  }
}

/** Returns the parked action (if any) and clears it. */
export function consumePendingDeepLink(): DeepLinkAction | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ACTION_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_ACTION_KEY);

    const parsed: unknown = JSON.parse(raw);
    return isDeepLinkAction(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
