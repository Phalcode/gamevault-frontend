import { useEffect, useRef } from "react";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useServerStatus } from "@/hooks/useServerStatus";
import {
  acknowledgeServerOutdatedNotice,
  isServerVersionTooOld,
  readServerOutdatedNoticeAck,
  serverOutdatedAckKey,
  serverOutdatedNoticeContent,
} from "@/utils/serverCompatibility";

/**
 * Warns the user once when the connected server is older than this client's
 * major version. Renders nothing, it only queues a warning dialog.
 *
 * The acknowledgement is keyed by client major and exact server version, so the
 * warning comes back after a client major update or when the server version
 * changes. A stable server that stays outdated is only reported once.
 */
export function ServerVersionNotice() {
  const { showAlert } = useAlertDialog();
  const { info } = useServerStatus();
  const serverVersion = info?.version ?? null;
  const noticeKey =
    serverVersion && isServerVersionTooOld(__APP_VERSION__, serverVersion)
      ? serverOutdatedAckKey(__APP_VERSION__, serverVersion)
      : null;
  const shownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!noticeKey || !serverVersion) return;
    // Effects run twice in React StrictMode; the dialog must only be queued once.
    if (shownRef.current === noticeKey) return;
    if (readServerOutdatedNoticeAck() === noticeKey) return;

    shownRef.current = noticeKey;

    void (async () => {
      await showAlert({
        tone: "warning",
        affirmativeText: "Got it",
        ...serverOutdatedNoticeContent(__APP_VERSION__, serverVersion),
      });
      acknowledgeServerOutdatedNotice(noticeKey);
    })();
  }, [noticeKey, serverVersion, showAlert]);

  return null;
}

export default ServerVersionNotice;
