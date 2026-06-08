# macOS Quick Look rendered preview extension for `.cook` / `.menu`

**Date:** 2026-06-08
**Status:** Approved design — pending implementation plan
**Supersedes (extends):** `docs/superpowers/specs/2026-06-06-quicklook-cook-menu-preview-design.md`
(which shipped the *plain-text* Quick Look on `main`). This is its deferred
"native rendered preview extension" future phase.

## Goal

When a user presses Space on a `.cook` or `.menu` file in macOS Finder (Quick Look),
show a **formatted, rendered recipe** — title, metadata, ingredients, cookware, steps —
instead of the raw source text. This is a native Quick Look **Preview Extension**
(`.appex`) embedded in the Cook Editor app bundle, code-signed and notarized alongside it.

It layers on top of the existing plain-text preview already on `main` (UTIs conforming
to `public.plain-text`) and **falls back to raw text** whenever parsing fails, so the
feature can never render a worse result than today.

## Scope decisions (settled during brainstorming)

| Decision | Choice |
| --- | --- |
| Preview fidelity | **Native rendered `.appex`** (formatted recipe), not plain text, not WebView. |
| Parser | **`CooklangParser`** — the `cooklang-rs` UniFFI Swift bindings, same Rust parser as the editor (`cooklang` 0.18.x) and the iOS app. |
| macOS parser slice | Extend `../cooklang-rs/bindings/build-swift.sh` to publish macOS slices and cut a `cooklang-rs` release (the maintainer can publish immediately). The editor consumes the released multi-platform `CooklangParserFFI.xcframework` via SPM, exactly like the iOS app. A locally-built xcframework is only a fallback for local iteration before the release is available. |
| Rendering | **Fresh, self-contained macOS SwiftUI view**, styling cribbed from the iOS `RecipeDetails` package but with **no dependency** on it (avoids porting iOS-only `DesignSystem`/`Utils`). |
| `.menu` support | **Same renderer, menu-aware**: `.menu` parses through the recipe parser; surface `RecipeReference` items prominently. Bounded by the parser having no dedicated menu model. |
| Thumbnails | **Out of scope** for v1 (preview only; no `QLThumbnailProvider`). |
| Platform | macOS only. Windows/Linux unaffected. |

## Background: what already exists on `main`

- `app/electron-builder.yml` → `mac.extendInfo` declares two **exported UTIs**
  (`md.cook.editor.cook`, `md.cook.editor.menu`), each conforming to `public.plain-text`,
  plus `CFBundleDocumentTypes` registering Cook Editor as their `Editor`.
- `CooklangElectronMainApplication` handles macOS `open-file` (double-click to open).
- `app/scripts/after-pack.js` is an existing electron-builder `afterPack` hook (runs after
  packing, **before** signing) — currently only strips source maps.

This design **reuses those UTIs** (the appex registers against them) and **extends
`after-pack.js`** to embed the appex.

## How macOS Quick Look extensions work (why this approach)

A Quick Look Preview Extension is an **app extension** (`.appex`) embedded in the host
app's `Contents/PlugIns/`. Its `Info.plist` declares:

- `NSExtensionPointIdentifier = com.apple.quicklook.preview`
- `NSExtensionPrincipalClass` → a `QLPreviewingController` (an `NSViewController` subclass)
- `QLSupportedContentTypes = [md.cook.editor.cook, md.cook.editor.menu]`

When the host app is registered with LaunchServices, macOS's Quick Look daemon discovers
the appex and routes spacebar previews of the declared UTIs to it. The appex's
`preparePreviewOfFile(at:)` is called with the file URL; it renders into its own view.
The appex runs **sandboxed and out-of-process** — it cannot reach the Electron app, Node,
or the NAPI addon, which is why it must parse Cooklang itself with a native Swift parser.

## Components

Each component has a single purpose, a defined interface, and can be built/tested on its own.

### A. `cooklang-rs` macOS binding *(change in sibling repo `../cooklang-rs`)*

**What:** `bindings/build-swift.sh` currently builds only `aarch64-apple-ios` and
`aarch64-apple-ios-sim`. Add macOS:

- Add Rust targets `aarch64-apple-darwin` and `x86_64-apple-darwin`; `lipo` them into a
  single universal macOS dylib/static lib.
- Wrap into a macOS `.framework` slice and add it to the `-create-xcframework` invocation
  alongside the existing iOS slices.
- Add `.macOS(.v12)` to the `platforms:` array in `Package.swift`.
- Cut a release that publishes the multi-platform `CooklangParserFFI.xcframework.zip`.

**Interface:** unchanged Swift API (`parseRecipe`, `CooklangRecipe`, metadata free
functions). Consumers just gain a macOS slice.

**Consumption:** the maintainer publishes a `cooklang-rs` release with macOS slices
immediately, so the editor's appex consumes the **released** multi-platform
`CooklangParserFFI.xcframework` via SPM (remote `binaryTarget`), exactly like the iOS app.
The local-build script (`macos/scripts/build-cooklang-macos-xcframework.sh`, mirroring
cooklang-rs's `USE_LOCAL_XCFRAMEWORK` switch) is retained only as a fallback for local
iteration ahead of the release; it is not on the critical path.

### B. Quick Look appex target (`macos/QuickLookExtension/`)

An Xcode project/target producing `CookQuickLook.appex`.

- `PreviewViewController: NSViewController, QLPreviewingController`.
- `preparePreviewOfFile(at url: URL) async throws`:
  1. Read file contents as UTF-8 text (size-capped; see Error handling).
  2. `let recipe = try parseRecipe(input: text, scalingFactor: 1.0)`.
  3. Build `RecipePreviewView(recipe:)` and host it with `NSHostingView`, set as the
     controller's view (pinned to edges).
  4. On any failure, fall back to a plain `NSTextView`/SwiftUI text view of the raw source.
- `Info.plist`: `NSExtensionPointIdentifier`, principal class, `QLSupportedContentTypes`
  = the two UTIs. `QLSupportsSearchableItems` not set (no Spotlight indexing in v1).
- Bundle id: `md.cook.editor.quicklook` (nested under the app's `md.cook.editor`).

**Depends on:** `CooklangParser` (component A) + `RecipePreviewView` (component C).

### C. `RecipePreviewView` (SwiftUI, self-contained, macOS `.v12`)

Pure rendering. **Input:** a `CooklangRecipe` (+ the metadata free-functions). **No deps**
beyond `CooklangParser` and SwiftUI.

Renders:

- **Header:** title (`metadataTitle`, fall back to file name), description if present.
- **Metadata row:** servings (`metadataServings`), total time (`metadataTime`), tags
  (`metadataTags`) as chips.
- **Ingredients:** list from `recipe.ingredients()` with `Amount` (quantity + unit) formatted.
- **Cookware:** list from `recipe.cookware()`.
- **Steps:** iterate `recipe.sections()` → `Block.step` → render `Step.items`
  (`Item.text` / `Item.ingredient` / `Item.cookware` / `Item.timer`) with inline emphasis
  for ingredients and timers; section titles as headings.
- **Menu-aware:** `Item`/`Ingredient.reference` of type `RecipeReference` rendered as a
  distinct "→ referenced recipe" element rather than a plain ingredient.

Styling approximates the iOS `RecipeDetails` look (spacing, type scale, accent for
ingredients/timers) but is re-implemented for macOS/AppKit, light + dark.

A small **view-model mapping layer** (`RecipePreview.from(recipe:)`) converts parser
types into a flat, testable struct the view renders — this is the unit-test seam.

### D. Build + embed integration

- `macos/scripts/build-quicklook.sh`: `xcodebuild` build of the appex target into a
  known output path (universal arm64 + x86_64, matching the Electron build matrix).
- `app/scripts/after-pack.js`: on `context.electronPlatformName === 'darwin'`, copy
  `CookQuickLook.appex` into `<App>.app/Contents/PlugIns/` (create the dir). Because this
  runs **before** electron-builder's mac signing step, the nested appex is signed as part
  of the bundle and then notarized with it.
- **Entitlements:** the appex needs its own entitlements (`com.apple.security.app-sandbox`
  + read-only file access for the previewed file) and hardened runtime. Add
  `build/entitlements.quicklook.plist`; ensure electron-builder/@electron/osx-sign signs
  the nested `.appex` with hardened runtime (it signs nested code by default; verify the
  appex is included and not skipped).
- **CI:** the existing macOS signing/notarization workflow gains an Xcode build step
  (build component A's local xcframework if not cached, then the appex) prior to
  `electron-builder`. No new runner — CI already runs on macOS with Apple credentials.

## Data flow

```
Finder spacebar (.cook/.menu)
  → Quick Look daemon resolves UTI (md.cook.editor.cook|menu)
  → loads CookQuickLook.appex (from Contents/PlugIns)
  → PreviewViewController.preparePreviewOfFile(at:)
      → read file text (capped)
      → parseRecipe(input:, scalingFactor: 1.0)   // cooklang-rs, fast
      → RecipePreview.from(recipe:)                 // view-model mapping
      → RecipePreviewView                           // SwiftUI
      → NSHostingView set as controller view
  → rendered preview panel
```

`.menu` follows the identical path; references are surfaced by the view.

## Error handling

- **Parse failure / non-recipe / empty / decode error** → render raw source text (never
  worse than the existing plain-text preview).
- **Oversized files** → cap the bytes read (e.g. a few hundred KB) before parsing/render to
  stay within Quick Look's time budget; show a truncation hint if capped.
- The whole `preparePreviewOfFile` body is wrapped so any thrown error degrades to the
  text fallback rather than a blank "No preview available" panel.

## Risk callouts

- **Signing the nested `.appex` (highest risk).** It must be signed with hardened runtime
  + its own sandbox entitlements and survive notarization *inside* the Electron `.app`.
  Primary verification: `codesign --verify --deep --strict` on the packaged app and a
  successful notarization + staple. This is where most implementation/verification effort
  goes.
- **`.menu` fidelity** is bounded by the parser having no menu model; pathological menus
  fall back to text. Acceptable for v1.
- **LaunchServices cache:** the appex may not register until the bundle is registered
  (usually automatic after install; otherwise `lsregister -f <App>.app` or re-login,
  and `qlmanage -r` to reset Quick Look). Document for testers; not a code issue.
- **xcframework platform drift:** the local-vendored macOS xcframework must track the same
  `cooklang-rs` version the editor's Rust addon uses to avoid parse divergence.

## Testing & verification

- **Swift unit tests** (Xcode target): `RecipePreview.from(recipe:)` mapping — ingredients,
  cookware, steps, metadata, and `RecipeReference` handling — over representative `.cook`
  and `.menu` fixtures.
- **Fast manual iteration:** `qlmanage -p sample.cook` (and `.menu`) renders the appex
  preview without a full Finder cycle; `qlmanage -m` shows registered generators.
- **Real test (the one that counts):** packaged, signed, notarized local build:
  1. Install/launch once so LaunchServices registers the bundle.
  2. Spacebar a `.cook` file → formatted recipe appears.
  3. Spacebar a `.menu` file → menu-aware render.
  4. Spacebar a deliberately malformed `.cook` → raw-text fallback (no blank panel).
  5. `codesign --verify --deep --strict <App>.app` passes; notarization stapled on the
     nested appex.

## Files / repos touched

| Path | Change |
| --- | --- |
| `../cooklang-rs/bindings/build-swift.sh`, `../cooklang-rs/Package.swift` | Add macOS targets + `.macOS` platform; release multi-platform xcframework. |
| `macos/QuickLookExtension/` (new) | Xcode project: `PreviewViewController`, `RecipePreviewView`, view-model, Info.plist, entitlements. |
| `macos/scripts/build-quicklook.sh` (new) | `xcodebuild` the appex. |
| `macos/scripts/build-cooklang-macos-xcframework.sh` (new) | Build/vendor local macOS `CooklangParserFFI.xcframework`. |
| `build/entitlements.quicklook.plist` (new) | Sandbox + read-only file entitlements for the appex. |
| `app/scripts/after-pack.js` | Embed `CookQuickLook.appex` into `Contents/PlugIns/` on macOS. |
| CI macOS workflow | Add Xcode build step before `electron-builder`. |

No changes to the existing UTIs / `extendInfo` (they already exist and are reused). No new
entitlements on the main app. Windows/Linux builds unaffected.

## Out of scope (possible future phases)

- Quick Look **thumbnails** (`QLThumbnailProvider`) so Finder/Spotlight icons show a mini recipe.
- Porting `RecipeDetails`/`DesignSystem` to multiplatform for a single shared renderer.
- iOS Quick Look extension.
- Custom Finder document icons for `.cook` / `.menu`.
- Spotlight/searchable-items indexing of recipe content.
