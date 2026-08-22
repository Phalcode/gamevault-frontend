# GameVault Web Frontend

React 19 + Vite + Tailwind (v4) powered frontend for the GameVault platform.

## Tech Stack

- PNPM
- React
- TypeScript
- Vite
- Tailwind CSS, Tailwind UI-Kit & Tailwind Components
- Tauri
- React Router

## Setup

`pnpm install`

## Scripts

- dev/start: Run local development server
- build: Production build
- preview: Preview production build locally
- lint: Run ESLint

## Notes

The project was migrated from a basic Vite template; most custom styling now relies on Tailwind utilities with a small set of extended theme tokens.

## Authentication Integration

The UI has been reconnected to the original authentication and user management logic:

- `AuthProvider` (`src/context/AuthContext.tsx`) handles login, token refresh, persistence, and exposes `authFetch` for authorized requests.
- `Login` component now performs real login against a GameVault backend and redirects to `/library` on success.
- Route guards in `src/main.tsx` prevent unauthenticated access to dashboard pages and redirect authenticated users away from the login screen.
- Admin Users page (`src/pages/Administration.tsx`) fetches real users and supports activation toggling, role changes, deletion and recovery through `useAdminUsers` (`src/hooks/useAdminUsers.ts`).

Persistence keys:

- `app_refresh_token` (refresh token)
- `app_server_url` (last used server base URL)

## Dev Autologin

Create `gamevault-frontend/.env.local` for dev-only automatic basic login:

```env
VITE_DEV_AUTOLOGIN=true
VITE_DEV_AUTOLOGIN_SERVER=https://example.gamevault.tld
VITE_DEV_AUTOLOGIN_USERNAME=devuser
VITE_DEV_AUTOLOGIN_PASSWORD=devpassword
```

- `.env.local` stays local because `*.local` already ignored.
- Autologin runs only in Vite dev mode and only when no refresh token exists yet.
- Login page reuses stored server URL, so failed refresh or failed dev autologin still lands on right server.
- Restart `pnpm dev` after changing env file.

Uncheck "Remember me" on login if you want the refresh token removed right after authenticating (session-only access token).

If backend endpoints change, update the paths in `AuthContext` and the admin hook.

## Desktop Auto-Updates

The desktop app (Tauri) updates itself from GitHub Releases.

**Channels** – switchable in **Settings → Desktop → Update channel**:

| Channel    | Branch    | Feed                                       |
| ---------- | --------- | ------------------------------------------ |
| `stable`   | `master`  | `releases/latest/download/latest.json`     |
| `unstable` | `develop` | `releases/download/unstable/unstable.json` |

The choice is persisted in `localStorage` (`gv_update_channel`).

**How it works** – on startup or via `Check for updates`, the frontend calls the Tauri updater through Rust commands in `src-tauri/src/lib.rs`. The app confirms with the user, downloads, verifies the signature, and installs. If the feed is not published yet, it falls back to the GitHub release page.

**Versioning** – stable uses the plain `package.json`/`Cargo.toml` version. Unstable builds get a CI-generated unique version `17.0.1-unstable.<run>.<attempt>`, injected into both the web and Rust builds and into the feed.

**CI** – `.github/workflows/deploy.yml` builds signed updater artifacts per OS (`.exe`+`.sig`, `.app.tar.gz`+`.sig`, `.AppImage`+`.sig`), merges them into `updater-channels.json`, and derives `latest.json` / `unstable.json`. Stale `unstable` assets are cleaned up automatically.

**Required GitHub config** – under **Settings → Secrets and variables → Actions**:

- Variable `GV_TAURI_UPDATER_PUBKEY` (public key content)
- Secret `TAURI_SIGNING_PRIVATE_KEY` (private key content)
- Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional)

Generate the keys once with `cargo tauri signer generate -w ~/.tauri/gamevault-updater.key`. Keep the private key and password safe — losing them breaks updates for existing installs.

**Local builds** – a normal `tauri build` produces no updater artifacts. To create them locally, build with the release config and signing env (`pnpm tauri build --config src-tauri/tauri.release.conf.json`). CI uses `src-tauri/tauri.release.generated.json` with the pubkey injected, since the Tauri bundler requires `plugins.updater.pubkey` in the parsed config.
