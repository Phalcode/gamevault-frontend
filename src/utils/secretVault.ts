import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";

/**
 * Shared access to the Stronghold vault.
 *
 * The desktop app keeps secrets (the auth refresh token, archive passwords) in
 * a Stronghold vault — the official Tauri secret store — instead of the
 * webview's `localStorage`, which any script in the page can read (XSS).
 *
 * The vault itself is encrypted with a random password that the Rust side
 * stores in an owner-only file, so the vault can be unlocked automatically
 * across restarts without asking the user.
 */
interface VaultHandle {
  store: import("@tauri-apps/plugin-stronghold").Store;
  stronghold: import("@tauri-apps/plugin-stronghold").Stronghold;
}

const VAULT_PATH = "vault.hold";
const CLIENT_NAME = "gamevault";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let vaultReady: Promise<VaultHandle> | null = null;

async function getVault(): Promise<VaultHandle> {
  if (!vaultReady) {
    vaultReady = (async () => {
      const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
      const dir = await appDataDir();
      const vaultPath = `${dir}/${VAULT_PATH}`;
      const password = await invoke<string>("get_or_create_vault_password");
      const stronghold = await Stronghold.load(vaultPath, password);
      let client;
      try {
        client = await stronghold.loadClient(CLIENT_NAME);
      } catch {
        client = await stronghold.createClient(CLIENT_NAME);
      }
      return { store: client.getStore(), stronghold };
    })();
    // If the vault can't be initialised, drop the cached promise so a later
    // call can retry.
    vaultReady.catch(() => {
      vaultReady = null;
    });
  }
  return vaultReady;
}

/** Reads a secret from the vault. Returns `null` when the key is not set. */
export async function readVaultSecret(key: string): Promise<string | null> {
  const { store } = await getVault();
  const data = await store.get(key);
  return data ? decoder.decode(data) : null;
}

/** Writes a secret to the vault and persists it to disk. */
export async function writeVaultSecret(
  key: string,
  value: string,
): Promise<void> {
  const { store, stronghold } = await getVault();
  await store.insert(key, Array.from(encoder.encode(value)));
  await stronghold.save();
}

/** Removes a secret from the vault and persists the change to disk. */
export async function removeVaultSecret(key: string): Promise<void> {
  const { store, stronghold } = await getVault();
  await store.remove(key);
  await stronghold.save();
}
