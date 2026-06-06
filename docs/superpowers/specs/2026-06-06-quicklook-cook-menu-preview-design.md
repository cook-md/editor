# macOS Quick Look preview + file association for `.cook` / `.menu`

**Date:** 2026-06-06
**Status:** Approved design — pending implementation plan

## Goal

When a user presses Space on a `.cook` or `.menu` file in macOS Finder (Quick Look),
show the file's contents instead of the generic "no preview available" panel. As part
of the same UTI registration, make Cook Editor the default application that opens these
files on double-click.

## Scope decisions

- **Preview fidelity: raw source text only.** The Quick Look panel renders the `.cook` /
  `.menu` source as plain text, exactly like previewing a `.txt` file. A fully *rendered*
  recipe preview (formatted ingredients, steps, etc.) would require a native Quick Look
  Preview Extension (`.appex`) built in Xcode, embedded in `Contents/PlugIns/`, and
  separately code-signed/notarized. That is explicitly **out of scope** here and may be a
  future phase.
- **Platform: macOS only.** Windows/Linux are unaffected.
- **No native code.** Part 1 is pure Info.plist metadata; Part 2 is TypeScript in the
  existing Electron main-process subclass.

## How macOS Quick Look works (why this approach)

Finder's spacebar preview is **not** rendered by the Electron app at runtime. macOS
decides how to preview a file from its UTI (Uniform Type Identifier). If a custom file
type's UTI is declared to **conform to `public.plain-text`**, macOS's built-in text
Quick Look generator renders it for free — no extension required.

`electron-builder`'s `fileAssociations` field generates `CFBundleDocumentTypes` but does
**not** let us control UTI *conformance*, so it cannot by itself make Quick Look show
text. The reliable path is to declare the exported UTIs ourselves via `mac.extendInfo`,
which merges arbitrary keys into the packaged `Info.plist`.

## Part 1 — Quick Look preview (the core ask)

Add to the `mac:` section of `app/electron-builder.yml` an `extendInfo` block declaring
two exported UTIs and their document types.

**Exported UTIs** (`UTExportedTypeDeclarations`):

| UTI                   | Extension | Conforms to          | Description     |
| --------------------- | --------- | -------------------- | --------------- |
| `md.cook.editor.cook` | `cook`    | `public.plain-text`  | Cooklang Recipe |
| `md.cook.editor.menu` | `menu`    | `public.plain-text`  | Cooklang Menu   |

Each declaration includes `UTTypeTagSpecification` with
`public.filename-extension: [<ext>]`. Conformance to `public.plain-text` is what unlocks
the built-in text preview.

> Note on `.menu`: this is a fairly generic extension. We declare an *exported* type we
> own (`md.cook.editor.menu`); if another installed app also claims `.menu`,
> LaunchServices resolves the handler by rank/recency. This is acceptable and not a
> blocker — we are not trying to seize `.menu` system-wide, only to provide a preview and
> a handler.

## Part 2 — File association / default-open

Declaring the UTIs alone makes the files show the Cook Editor icon and appear under
"Open With → Cook Editor", but **double-click will not actually open the file**: Theia's
Electron main process listens for `open-url` (the `cook://` scheme) and `second-instance`
/ CLI args, but **not** for macOS's `open-file` event, which is what Finder fires on
double-click.

### 2a. Document type registration

In the same `extendInfo` block, add `CFBundleDocumentTypes` entries that bind each UTI to
the app as an editor:

- `CFBundleTypeRole: Editor`
- `LSItemContentTypes: [md.cook.editor.cook]` (and the menu UTI respectively)
- `LSHandlerRank: Owner`

### 2b. `open-file` handler

The `cooklang-branding` package already subclasses `ElectronMainApplication` as
`CooklangElectronMainApplication` and rebinds it (`packages/cooklang-branding/src/
electron-main/`). Both `hookApplicationEvents()` and `handleMainCommand()` are
`protected`, so the subclass is the access-correct, lowest-friction home for this — no
new package and no cross-package coupling.

Override `hookApplicationEvents()` in `CooklangElectronMainApplication`:

1. Call `super.hookApplicationEvents()` to preserve all existing listeners
   (`will-quit`, `second-instance`, `open-url`, etc.).
2. Register `app.on('open-file', (event, filePath) => { ... })`:
   - `event.preventDefault()`.
   - Forward to the existing flow: `this.handleMainCommand({ file: filePath,
     cwd: path.dirname(filePath), secondInstance: true })`.

This routes a double-clicked file through the **exact same code path** Theia already uses
for CLI file arguments (`cook-editor <path>`) and second-instance launches. We are not
inventing new open behavior — double-click behaves identically to launching the app with
the file as an argument. (How Theia then presents that path — as a single-file workspace
vs. opening an editor — is existing, tested Theia behavior and is intentionally not
redesigned here. A future refinement could open the file's parent folder as the workspace
and reveal the file; that is out of scope.)

`open-file` is registered only on non-Windows, consistent with how Theia gates `open-url`.

## Files touched

| File                                                                                  | Change                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `app/electron-builder.yml`                                                            | Add `mac.extendInfo` with `UTExportedTypeDeclarations` + `CFBundleDocumentTypes` |
| `packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts`  | Override `hookApplicationEvents()` to handle `open-file`            |

No new packages, no new entitlements, no native targets. Hardened runtime and
notarization are unaffected because nothing is added to the signed binary set.

## Testing & verification

- **Unit-level:** the `open-file` override is thin glue over `handleMainCommand`; verify
  by inspection and a focused test of the path-resolution call if practical (main-process
  Electron code is awkward to unit test — primary verification is manual on a packaged
  build).
- **Manual (the real test):**
  1. `cd app && npm run package` to produce a signed local `.app`/DMG.
  2. Install/launch it once so LaunchServices registers the bundle.
  3. In Finder, select a `.cook` file and press Space → the source text should appear in
     the Quick Look panel. Repeat for a `.menu` file.
  4. Double-click a `.cook` file → Cook Editor opens it (launching cold and while already
     running).

## Caveats / known risks

- **LaunchServices cache:** associations and previews may not appear until the bundle is
  registered. After install this usually happens automatically; if not, force it with
  `/System/Library/Frameworks/CoreServices.framework/.../lsregister -f <App>.app` or a
  re-login. Document this for testers; it is not a code issue.
- **Cold-launch `open-file` timing:** when the app is launched *by* a Finder double-click
  (not yet running), macOS buffers the `open-file` event until a listener attaches.
  `hookApplicationEvents()` runs during startup, mirroring how the existing `open-url`
  handler already works in this app, so this is expected to function — but it is the main
  thing to verify in manual testing (step 4, cold launch).
- **`.menu` extension collisions:** see the note in Part 1; not a blocker.

## Out of scope (possible future phases)

- Native Quick Look Preview Extension for a *rendered* (formatted) recipe/menu preview.
- Quick Look thumbnails (file icons showing recipe content).
- Custom document-type icons for `.cook` / `.menu` in Finder.
- "Open parent folder + reveal file" double-click behavior.
