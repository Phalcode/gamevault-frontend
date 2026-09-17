import { useEffect, useRef } from "react";
import { useAlertDialog } from "@/context/AlertDialogContext";
import {
  markPrereleaseNoticeSeen,
  prereleaseChannelOfBuild,
  prereleaseNoticeContent,
  shouldShowPrereleaseNotice,
} from "@/utils/prereleaseNotice";

/**
 * Warns the user the first time a pre-release build (Early Access / unstable)
 * is launched. Renders nothing — it only queues a warning dialog, which the
 * provider holds on screen until it is acknowledged.
 */
export function PrereleaseNotice() {
  const { showAlert } = useAlertDialog();
  const shownRef = useRef(false);

  useEffect(() => {
    // Effects run twice in React StrictMode; the dialog must only be queued once.
    if (shownRef.current) return;

    const channel = prereleaseChannelOfBuild();
    if (!channel) return;

    shownRef.current = true;

    void (async () => {
      // The acknowledgement lives in the app's settings file (desktop builds),
      // so it survives updates and the warning stays a one-time thing.
      if (!(await shouldShowPrereleaseNotice(channel))) return;

      await showAlert({
        tone: "warning",
        affirmativeText: "I understand",
        ...prereleaseNoticeContent(channel, __APP_VERSION__),
      });

      // Only remember the warning once it was actually acknowledged, so a user
      // who closes the app before reading it still sees it on the next launch.
      await markPrereleaseNoticeSeen(channel);
    })();
  }, [showAlert]);

  return null;
}

export default PrereleaseNotice;
