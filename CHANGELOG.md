# GameVault Frontend Changelog

## 17.1.0

### Changes

- Added a Refresh button to the window title bar that reloads the current page.
- Auto-install on Linux now makes extracted shell scripts (`.sh`/`.bash`/`.run`/etc.) executable automatically.
- Fixed "Open Folder" doing nothing on Linux: folder and URL opening now use the official `tauri-plugin-opener`, with WSL support preserved.
- Added an "Open" button to each download location in Settings to open the folder in your file manager.
- Installed games are now detected even when the `installationfinished` flag was never written (e.g. self-extracting installers), by verifying the installation directory has content.
- Fixed GOG/self-extracting installers being reported as failed: a non-zero wrapper exit code no longer counts as failure if the installation directory actually got populated.
- After installation the launch executable is now auto-detected (falling back to the first available one) when none is configured.
- Uninstalling a game or deleting a download now cleans up the empty leftover folder structure, and the hidden `.gamevault.*` metadata files no longer block that cleanup.
- Fixed a Wayland/Steam Deck startup crash (`Could not create default EGL display: EGL_BAD_PARAMETER`) by disabling WebKitGTK's dmabuf renderer on Linux.
- Users can now delete their own progress entries, and administrators can delete progress entries of other users, with an improved confirmation UI that names the affected game.

## 17.0.0

### Changes

- Implemented Gamepad support for UI
- Support for multiple game versions and version selection in the library. (Legacy Client always downloads the latest version)
- New installed games section in the library for tauri builds
- Game time tracker
- Fixed a bug where only the first 1000 Tags would be loaded in the library, now all tags are loaded
- [#22](https://github.com/Phalcode/gamevault-frontend/issues/22) - Added support for markdown in game descriptions and notes.
- [#32](https://github.com/Phalcode/gamevault-frontend/issues/32) - Redesigned the game settings page a bit.
- [#19](https://github.com/Phalcode/gamevault-frontend/issues/19) - Added News Editor for admins to edit server news with markdown support.
- Added an Early Access update channel, published from the `early-access` branch, alongside the existing stable and unstable channels.
- The desktop update channel now defaults to the channel the build was created for; users can still switch between stable, early-access, and unstable.
- Early Access and Unstable channels are only offered in the Settings update-channel picker after unlocking Developer Tools (tap the version number 5×). Developer Tools can be toggled off again the same way.
- Polished Linux and macOS packaging: the Debian package and binary are now `gamevault`, with proper license, homepage and description, a dedicated `.desktop` entry, and a bundled Debian changelog.
- Release assets on the `unstable` and `early-access` releases are now cleaned up by a dedicated, manifest-aware CI job that also runs after aborted or partially-failed builds, and are named consistently.
- Improved startup and loading performance via route-level code splitting, vendor bundle splitting, memoized game cards, lazy/async media loading, and deferred session-replay analytics.
- Fixed the download button not working on Linux when no root path is set.
- Surface immediate game launch failures to users.
- Fixed playtime tracking on Linux.
- Removed the debug media ID hover tooltip.
- Redesigned toast notifications to match the design system.
- Fixed library cards shrinking when pressing buttons inside them.
- Prefill demo credentials when the demo server is selected.
- Default and lock the server URL when the web UI is served by the backend.
- The logo now switches its text variant with the theme.
- Surface and fix non-executable shell scripts in launch options, added a sudo fallback for Linux, and allow running games as root on Linux.
- Stabilized popup heights so they no longer resize with content.


## 16.2.1

### Changes

- [#5](https://github.com/Phalcode/gamevault-frontend/issues/5) - Dynamically show and hide Basic Auth and SSO options on Login and Register pages based on server configuration
- [#6](https://github.com/Phalcode/gamevault-frontend/issues/6) - Use proper href links on game cards and community progress list for better accessibility (middle-click/right-click to open in new tab)
- [#9](https://github.com/Phalcode/gamevault-frontend/issues/9) - Fix search with special characters (apostrophes) causing blank page due to excessive history API calls (added debounce and duplicate URL check)

## 16.2.0

### Changes

- Added GameSettings
- Extended library filters
- Bug fix: Youtube player error 153

## 16.1.0

### Changes

- Added GameView Layout
- Added Support for SSO
- Added Sorting + Filtering

## 16.0.0

### Changes

- Initial release
