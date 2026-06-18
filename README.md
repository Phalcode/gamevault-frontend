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
