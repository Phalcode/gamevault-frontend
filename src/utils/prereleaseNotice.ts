import { defaultChannelForBuild, type UpdateChannel } from "./updater";

/** Build channels that are explicitly not meant for everyday use. */
export type PrereleaseChannel = "early-access" | "unstable";

/**
 * Remembers which pre-release build the user has already been warned about, so
 * the warning is only shown once per channel.
 */
export const PRERELEASE_NOTICE_KEY = "gv_prerelease_notice_channel";

export function isPrereleaseChannel(
  channel: UpdateChannel,
): channel is PrereleaseChannel {
  return channel === "early-access" || channel === "unstable";
}

/**
 * The pre-release channel this build was created for, or `null` for stable
 * builds (and for local dev/web builds, which have no channel at all).
 */
export function prereleaseChannelOfBuild(): PrereleaseChannel | null {
  const channel = defaultChannelForBuild();
  return isPrereleaseChannel(channel) ? channel : null;
}

/** Whether the first-launch warning for `channel` still has to be shown. */
export function shouldShowPrereleaseNotice(
  channel: PrereleaseChannel,
): boolean {
  try {
    return localStorage.getItem(PRERELEASE_NOTICE_KEY) !== channel;
  } catch {
    // Storage unavailable (private mode / blocked): showing the warning once
    // extra is harmless, so fail open.
    return true;
  }
}

/** Acknowledges the warning for `channel` so it isn't shown again. */
export function markPrereleaseNoticeSeen(channel: PrereleaseChannel): void {
  try {
    localStorage.setItem(PRERELEASE_NOTICE_KEY, channel);
  } catch {
    // localStorage unavailable
  }
}

export interface PrereleaseNoticeContent {
  title: string;
  description: string;
}

const SHARED_ADVICE =
  "Keep a backup of anything important, report issues on GitHub, and switch back to the Stable update channel in Settings → About → Updates if you need a reliable build.";

/**
 * Warning copy for the first launch of a pre-release build. The wording makes
 * it clear that these builds are for testers/developers, that extra setup may
 * be required and that problems are expected.
 */
export function prereleaseNoticeContent(
  channel: PrereleaseChannel,
  version: string,
): PrereleaseNoticeContent {
  if (channel === "unstable") {
    return {
      title: "You are running an unstable build",
      description:
        `You are using GameVault v${version}, an unstable development build that tracks the development branch. ` +
        "It is meant for developers and testers who are comfortable troubleshooting, not for everyday use: " +
        "additional setup steps may be necessary, features can change or disappear at any time, and crashes, " +
        `broken downloads or lost settings/progress are expected rather than rare. ${SHARED_ADVICE}`,
    };
  }

  return {
    title: "You are running an Early Access build",
    description:
      `You are using GameVault v${version}, an Early Access build that is still being worked on. ` +
      "It is meant for members of the early access program and other testers who are comfortable troubleshooting, " +
      "not for everyday use: additional setup steps may be necessary, parts of the app can behave unexpectedly, " +
      `and you will run into issues more often than on a stable release. ${SHARED_ADVICE}`,
  };
}
