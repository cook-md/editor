# Changelog

All notable changes to Cook Editor are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Cook Editor is built on [Eclipse Theia](https://theia-ide.org/). For changes
to the underlying Theia framework, see the
[Theia changelog](https://github.com/eclipse-theia/theia/blob/master/CHANGELOG.md).

## [0.1.0-alpha.9] - 2026-04-23

### Added
- Added EPL attribution, written-source offer, and an About dialog disclosing
  the Eclipse Theia upstream and the project's EPL-2.0 license.

## [0.1.0-alpha.8] - 2026-04-22

### Fixed
- Including a recipe in another recipe now pulls in any sub-recipe references
  with their resolved scales applied.
- Resolved servings and yield units correctly when adding a menu to the
  shopping list.

### CI
- The release workflow now verifies required frontend modules after the
  webpack bundle step to catch missing chunks before publishing.

## [0.1.0-alpha.7] - 2026-04-21

### Fixed
- Restored frontend features (autocomplete, ingredient/cookware lookups) in
  the Electron build that had regressed after the upstream merge.

## [0.1.0-alpha.6] - 2026-04-20

### Added
- Manual `Check for Updates` command in the menu, plus auto-updater fixes so
  users on shipped builds receive new alpha releases.

## [0.1.0-alpha.5] - 2026-04-20

### Fixed
- `cookbot.proto` is now packaged into `app.asar`, fixing AI features in the
  shipped binary.

## [0.1.0-alpha.4] - 2026-04-20

### Added
- Restored the full release build matrix (macOS x64 + arm64, Windows, Linux)
  after stabilizing CI.

### Fixed
- Cooklang LSP autocomplete now stays responsive after workspace changes
  (folder open/close, recipe rename, etc.).
- Aligned `@theia/monaco-editor-core` versions across packages to prevent the
  silent dual-Monaco registration bug.

### CI
- Cached `@theia/core` shared shims and the ffmpeg native build to cut release
  workflow runtime.
- Rebuild native dependencies for x64 before webpack bundling on Intel macOS.
- Switched to native `macos-13` runner for x64 instead of cross-compiling on
  arm64.

## [0.1.0-alpha.2] - 2026-04-17

### Added
- macOS code signing and notarization in the release workflow.

### Fixed
- macOS zip artifact filenames now include the architecture suffix to avoid
  collisions between x64 and arm64 builds.

### CI
- Cache `node_modules`, the TypeScript build output, and electron-builder
  downloads to speed up release runs.

## [0.1.0-alpha.1] - 2026-04-17

### Added
- Subscription account widget shows the AI token balance and reset date.
- Pro plan fallback when `planName` is absent on active subscriptions.
- Refresh subscription state when the account widget activates.
- Desktop-return callback for the upgrade flow so users land back in the
  editor after subscribing.

### Changed
- Renamed CookEd → **Cook Editor** and refreshed the splash screen.
- Dropped the sync-feature paywall: workspace sync is available to every
  logged-in user.
- AI credits and plan label now read directly from the cook.md API
  (`ai_credits_remaining`, `plan_slug`, `plan_name`).

### Fixed
- Stopped shipping the Rust `target/` cache inside macOS bundles, cutting
  installer size significantly.
- Honor `WEB_BASE_URL` for `Get AI Addon` and other external links from the
  account widget (lets staging builds point at staging cook.md).
- Re-seed the frontend subscription cache on token refresh so stale state
  doesn't survive a re-login.
- Use Theia's shared-dependencies import for `@lumino/messaging` to avoid
  duplicate copies in the Electron build.

### Build
- `verify-mac-bundle.sh` script for sanity-checking release DMGs locally.

## [0.1.0-alpha.0] - 2026-04-15

Initial Cook Editor pre-release built on Eclipse Theia 1.68. Includes:

- Cooklang syntax highlighting (TextMate grammar)
- Cooklang language server with autocomplete for ingredients, cookware, and
  recipe metadata
- Recipe view, shopping list, pantry, and AI assistance widgets
- Native Rust addon (`@cook-md/cooklang-native`) wrapping the upstream
  cooklang parser via NAPI-RS
- Account widget with cook.md sign-in and subscription management
- macOS, Windows, and Linux Electron builds (DMG, EXE, AppImage, deb)

[0.1.0-alpha.9]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.9
[0.1.0-alpha.8]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.8
[0.1.0-alpha.7]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.7
[0.1.0-alpha.6]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.6
[0.1.0-alpha.5]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.5
[0.1.0-alpha.4]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.4
[0.1.0-alpha.2]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.1
[0.1.0-alpha.0]: https://github.com/cook-md/editor/releases/tag/v0.1.0-alpha.0
