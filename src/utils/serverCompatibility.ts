/**
 * Client/server compatibility checks.
 *
 * GameVault treats the major version as the compatibility boundary: a client
 * talks to every server of its own major version, and a server with a lower
 * major version is too old for it. This mirrors the rule the server uses when
 * it picks a Web UI release.
 */
export interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

/** localStorage key remembering which outdated server was already reported. */
export const SERVER_OUTDATED_NOTICE_KEY = "gv_server_outdated_notice";

/** Parses `17`, `17.1`, `17.1.2` and a leading `v`. Returns `null` otherwise. */
export function parseVersionParts(
  version: string | null | undefined,
): VersionParts | null {
  if (typeof version !== "string") return null;

  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version.trim());
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  const patch = Number(match[3] ?? 0);
  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null;
  }

  return { major, minor, patch };
}

/**
 * Whether the connected server is too old for this client. Unknown or
 * unparsable versions never trigger a warning.
 */
export function isServerVersionTooOld(
  clientVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): boolean {
  const client = parseVersionParts(clientVersion);
  const server = parseVersionParts(serverVersion);
  if (!client || !server) return false;
  return server.major < client.major;
}

/**
 * Identifies one warning: the client's major version plus the exact server
 * version. A server update or a client major update shows the warning again.
 */
export function serverOutdatedAckKey(
  clientVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): string | null {
  const client = parseVersionParts(clientVersion);
  const server = parseVersionParts(serverVersion);
  if (!client || !server) return null;
  return `${client.major}:${server.major}.${server.minor}.${server.patch}`;
}

export function readServerOutdatedNoticeAck(): string | null {
  try {
    return localStorage.getItem(SERVER_OUTDATED_NOTICE_KEY);
  } catch {
    return null;
  }
}

export function acknowledgeServerOutdatedNotice(key: string): void {
  try {
    localStorage.setItem(SERVER_OUTDATED_NOTICE_KEY, key);
  } catch {
    /* storage unavailable */
  }
}

export interface ServerOutdatedNoticeContent {
  title: string;
  description: string;
}

export function serverOutdatedNoticeContent(
  clientVersion: string,
  serverVersion: string,
): ServerOutdatedNoticeContent {
  const client = parseVersionParts(clientVersion);
  const expectedMajor = client ? `${client.major}.x` : "a newer";

  return {
    title: "Server is outdated",
    description: `This client is version ${clientVersion} and expects a GameVault Server ${expectedMajor}. The connected server runs ${serverVersion}, which is too old for this client. Some features may be missing or fail. Ask your server admin to update GameVault Server.`,
  };
}
