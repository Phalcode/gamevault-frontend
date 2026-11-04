import { getServerNamespace } from "@/utils/mediaCache";
import { isTauriApp } from "@/utils/tauri";
import { readVaultSecret, writeVaultSecret } from "@/utils/secretVault";

/**
 * Default extraction passwords.
 *
 * One password rarely covers a whole library, so the list is ordered: when an
 * archive is password protected, GameVault tries each saved password in turn
 * until one opens it. A password typed on a download card always goes first.
 *
 * The list is scoped per server and account, so switching servers or users
 * never leaks one library's passwords into another. On the desktop app the
 * list lives in the Stronghold vault (archive passwords are shared secrets);
 * the web build falls back to `localStorage`.
 */
export interface ArchivePasswordScope {
  serverUrl: string;
  userId: number | string | null | undefined;
}

const STORAGE_PREFIX = "gv_archive_passwords";

/** Drops empty entries and duplicates, keeping the original order. */
export function normalizeArchivePasswords(values: Iterable<string>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || result.includes(trimmed)) continue;
    result.push(trimmed);
  }
  return result;
}

/**
 * Passwords to try for one extraction: the one the user just typed first, then
 * the saved defaults in their configured order.
 */
export function buildArchivePasswordCandidates(
  manualPassword: string | null | undefined,
  savedPasswords: readonly string[],
): string[] {
  return normalizeArchivePasswords([manualPassword ?? "", ...savedPasswords]);
}

/** Storage key for the list, or `null` when the scope is incomplete. */
export function getArchivePasswordStorageKey(
  scope: ArchivePasswordScope,
): string | null {
  if (!scope.serverUrl || scope.userId === null || scope.userId === undefined) {
    return null;
  }
  if (scope.userId === "") return null;
  return `${STORAGE_PREFIX}:${getServerNamespace(scope.serverUrl)}:${scope.userId}`;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function parseStored(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeArchivePasswords(
      parsed.filter((entry): entry is string => typeof entry === "string"),
    );
  } catch {
    return [];
  }
}

export async function loadArchivePasswords(
  scope: ArchivePasswordScope,
): Promise<string[]> {
  const key = getArchivePasswordStorageKey(scope);
  if (!key) return [];

  if (isTauriApp()) {
    try {
      return parseStored(await readVaultSecret(key));
    } catch (error) {
      console.warn(
        "[archivePasswords] vault read failed, using localStorage",
        error,
      );
    }
  }
  return parseStored(readLocal(key));
}

/** Persists the list and returns the stored (normalized) value. */
export async function saveArchivePasswords(
  scope: ArchivePasswordScope,
  passwords: readonly string[],
): Promise<string[]> {
  const normalized = normalizeArchivePasswords(passwords);
  const key = getArchivePasswordStorageKey(scope);
  if (!key) return normalized;

  const raw = JSON.stringify(normalized);
  if (isTauriApp()) {
    try {
      await writeVaultSecret(key, raw);
      return normalized;
    } catch (error) {
      console.warn(
        "[archivePasswords] vault write failed, using localStorage",
        error,
      );
    }
  }
  writeLocal(key, raw);
  return normalized;
}
