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

## Desktop Updater Releases

- Stable desktop auto-updates are published from the `master` branch through GitHub Releases.
- Stable uses `latest.json` from the latest stable GitHub release.
- Unstable uses `unstable.json` from the `unstable` prerelease tag.
- CI keeps a canonical `updater-channels.json` as the source of truth and derives `latest.json` and `unstable.json` from it.
- The canonical `updater-channels.json` is stored on the latest stable release when one exists, and is merged forward by both `master` and `develop` runs.
- The desktop app now lets users switch between `stable` and `unstable` channels in Settings.
- CI publishes the native updater artifacts directly and no longer adds legacy `gamevault-tauri-*.zip` bundles for the desktop client.
- On the moving `unstable` release, CI keeps the real versioned native asset names and deletes stale old assets so the release page stays clean over time.
- CI expects a repository variable named `GV_TAURI_UPDATER_PUBKEY`.
- CI expects the signing secret `TAURI_SIGNING_PRIVATE_KEY` and optionally `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Both stable and unstable desktop updater releases are signed in CI.
- CI generates `src-tauri/tauri.release.generated.json` from `src-tauri/tauri.release.conf.json` and injects the updater public key there, because the Tauri bundler requires `plugins.updater.pubkey` in the parsed config.
- Local desktop production builds do not generate updater artifacts unless you build with the release overlay config in `src-tauri/tauri.release.conf.json` or generate the same release config with your public key injected.
