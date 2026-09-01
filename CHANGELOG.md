# GameVault Frontend Changelog

## 17.1.0

### Changes

- Added a Refresh button to the window title bar that reloads the current page.
- Auto-install on Linux now makes extracted shell scripts (`.sh`/`.bash`/`.run`/etc.) executable automatically.
- Fixed "Open Folder" doing nothing on Linux: folder and URL opening now use the official `tauri-plugin-opener`, with WSL support preserved.
- Added an "Open" button to each download location in Settings to open the folder in your file manager.
- Installed games are now detected even when the `installationfinished` flag was never written (e.g. self-extracting installers), by verifying the installation directory has content.
- Fixed recovered download cards incorrectly showing an already-installed game as "not installed" after a restart: a version is now treated as installed when its installation directory has content, matching the installed-games list.
- Fixed GOG/self-extracting installers being reported as failed: a non-zero wrapper exit code no longer counts as failure if the installation directory actually got populated.
- After installation the launch executable is now auto-detected (falling back to the first available one) when none is configured.
- Uninstalling a game or deleting a download now cleans up the empty leftover folder structure.
- Fixed the game settings staying open after an uninstall; they now close once the game is uninstalled, and the installed game card refreshes/disappears correctly.
- After an uninstall, any leftover files/folders the uninstaller failed to remove are detected and the user is asked whether to delete them.
- Fixed the Wayland startup crash on the Linux AppImage (`Could not create default EGL display: EGL_BAD_PARAMETER`) by preloading the host's `libwayland-client` through a patched AppImage `AppRun` wrapper. The `.deb` build already uses the system library and is unaffected.
- Administrators can delete progress entries of other users
- Added a native OS taskbar/dock download progress indicator for desktop builds (Windows taskbar, macOS dock, Linux launcher)
- Added an "Installed" badge to server game cards so already-installed games are easy to spot at a glance.
- The download button on a game's page now collapses into a compact icon-only button when the game is already installed.
- Downloads interrupted by the app quitting are now automatically resumed on the next launch; downloads you intentionally paused or cancelled stay paused.
- Fixed resuming a download not preserving its configured download location (root path).
- Added a disk-usage breakdown for each download location in the installed-game settings, showing total and free space plus how much is used by the current game, other games, and unmanaged files.
- Windows executables on Linux can now run through umu-launcher: GameVault automatically installs umu-launcher, launches the game through it (showing a setup overlay while UMU-Proton and the Steam runtime download), and tracks playtime.
- Added optional per-game umu-launcher overrides in the game settings (umu-database ID, store, Proton path, and Wine prefix).
- Improved the widescreen layout so library content sits flush against the sidebar instead of being awkwardly re-centered on large monitors.
- Debounced the library game search so the server is no longer hit on every keystroke.
- Renamed the unnamed-version placeholder from "Unknown Version" to "Unspecified". Existing installs that still use the old folder name continue to work (both the old and new names are supported, with no on-disk folder rename).
- Fixed regional date formatting: dates now follow the locale the computer uses (e.g. `dd.mm.yyyy` for German) everywhere instead of a fixed `en-US` format, keeping release dates, filters and "last played" timestamps consistent. Date-only values are parsed as local dates so they no longer shift a day/year in timezones west of UTC, and the "Last Played" box keeps its compact two-line layout.
- Numbers are now formatted with the locale's decimal and thousands separators (e.g. `1,5 GB` for German instead of `1.5 GB`), covering file sizes, download speeds/limits, playtime and progress percentages.

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
