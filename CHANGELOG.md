# GameVault Frontend Changelog

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
