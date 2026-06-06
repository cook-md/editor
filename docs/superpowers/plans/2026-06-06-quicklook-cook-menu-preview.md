# macOS Quick Look Preview + File Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make macOS Finder show the source text of `.cook` / `.menu` files on Space (Quick Look), and make Cook Editor the default app that opens them on double-click.

**Architecture:** Two changes, no native code. (1) Declare custom UTIs for `.cook`/`.menu` that conform to `public.plain-text` via `mac.extendInfo` in `app/electron-builder.yml` — this unlocks macOS's built-in text Quick Look generator and registers the document types. (2) Override `hookApplicationEvents()` in the existing `CooklangElectronMainApplication` subclass to handle macOS's `open-file` event (which Theia core does not listen for) by routing the file through Theia's existing `handleMainCommand` flow.

**Tech Stack:** electron-builder (YAML `extendInfo` → `Info.plist`), Theia Electron main process (TypeScript), InversifyJS.

**Design spec:** `docs/superpowers/specs/2026-06-06-quicklook-cook-menu-preview-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `app/electron-builder.yml` | Packaging config; adds UTI exported types + document types to the macOS `Info.plist` | Modify (`mac:` block) |
| `packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts` | Electron main-process app subclass; add `open-file` handling | Modify (add `hookApplicationEvents` override) |

No new files, no new packages, no entitlements changes.

---

## Task 1: Declare `.cook` / `.menu` UTIs and document types

This is packaging metadata. There is no unit test; verification is building an unsigned
`.app` and inspecting the generated `Info.plist` with `plutil`.

**Files:**
- Modify: `app/electron-builder.yml` (the `mac:` block, currently around lines 67-86)

- [ ] **Step 1: Add the `extendInfo` block to the `mac:` section**

Open `app/electron-builder.yml`. The `mac:` block currently ends with `notarize: true`.
Add an `extendInfo:` key inside the `mac:` block (sibling of `icon:`, `target:`,
`notarize:`, etc. — keep the existing keys). Insert this immediately after the
`notarize: true` line, at the same indentation level as the other `mac:` keys:

```yaml
  # Custom file types for .cook / .menu. Conformance to public.plain-text lets
  # macOS Quick Look render the source on spacebar with no native extension.
  # The CFBundleDocumentTypes entries register Cook Editor as an Editor for them.
  extendInfo:
    CFBundleDocumentTypes:
      - CFBundleTypeName: Cooklang Recipe
        CFBundleTypeRole: Editor
        LSHandlerRank: Owner
        LSItemContentTypes:
          - md.cook.editor.cook
      - CFBundleTypeName: Cooklang Menu
        CFBundleTypeRole: Editor
        LSHandlerRank: Owner
        LSItemContentTypes:
          - md.cook.editor.menu
    UTExportedTypeDeclarations:
      - UTTypeIdentifier: md.cook.editor.cook
        UTTypeDescription: Cooklang Recipe
        UTTypeConformsTo:
          - public.plain-text
        UTTypeTagSpecification:
          public.filename-extension:
            - cook
      - UTTypeIdentifier: md.cook.editor.menu
        UTTypeDescription: Cooklang Menu
        UTTypeConformsTo:
          - public.plain-text
        UTTypeTagSpecification:
          public.filename-extension:
            - menu
```

- [ ] **Step 2: Validate the YAML parses**

Run: `cd app && npx js-yaml electron-builder.yml > /dev/null && echo "YAML OK"`
Expected: prints `YAML OK` (no parse error). If `js-yaml` CLI is unavailable, use:
`node -e "require('js-yaml').load(require('fs').readFileSync('electron-builder.yml','utf8')); console.log('YAML OK')"`
Expected: prints `YAML OK`.

- [ ] **Step 3: Build an unsigned app bundle**

Run: `cd app && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir`
Expected: completes and produces `app/dist/mac*/Cook Editor.app` (arch-dependent
directory name, e.g. `dist/mac-arm64`). This skips signing/notarization.

> Note: this step requires the app to have been bundled first (`npm run bundle`). If
> `src-gen`/`lib` are stale or missing, run `cd app && npm run bundle` before this step.

- [ ] **Step 4: Verify the Info.plist contains the UTI declarations**

Run:
```bash
cd app
APP=$(ls -d dist/mac*/*.app | head -1)
plutil -extract UTExportedTypeDeclarations xml1 -o - "$APP/Contents/Info.plist" | grep -E "md.cook.editor.(cook|menu)|public.plain-text"
plutil -extract CFBundleDocumentTypes xml1 -o - "$APP/Contents/Info.plist" | grep -E "md.cook.editor.(cook|menu)|Cooklang"
```
Expected: the first command prints lines containing `md.cook.editor.cook`,
`md.cook.editor.menu`, and `public.plain-text`. The second prints the document type
names/UTIs. If either `plutil -extract` errors with "does not exist", the `extendInfo`
keys were not merged — recheck indentation in Step 1.

- [ ] **Step 5: Commit**

```bash
git add app/electron-builder.yml
git commit -m "feat(macos): declare .cook/.menu UTIs for Quick Look + file association"
```

---

## Task 2: Handle macOS `open-file` so double-click opens the file

Theia core's `hookApplicationEvents()` registers `will-quit`, `second-instance`, and
`open-url` listeners but never `open-file`, so a double-clicked document does nothing.
We override the method in the existing `CooklangElectronMainApplication` subclass, call
`super` to keep all existing listeners, then add an `open-file` listener that forwards to
the same `handleMainCommand` path Theia uses for CLI/second-instance file arguments.

Electron main-process code is not practically unit-testable here; verification is a
TypeScript compile + lint, plus the manual checks in Task 3.

**Files:**
- Modify: `packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts`

- [ ] **Step 1: Add the `app` import**

The file already imports from `@theia/core/electron-shared/electron`. Change that import
line (currently `import { BrowserWindowConstructorOptions } from '@theia/core/electron-shared/electron';`)
to also import `app`:

```ts
import { app, BrowserWindowConstructorOptions } from '@theia/core/electron-shared/electron';
```

(`path` is already imported as `import * as path from 'path';` — no change needed.)

- [ ] **Step 2: Add the `hookApplicationEvents` override**

Inside the `CooklangElectronMainApplication` class body (e.g. after the existing
`getDefaultOptions()` override), add:

```ts
    /**
     * Theia core does not register a macOS `open-file` handler, so double-clicking a
     * `.cook` / `.menu` file in Finder (or "Open With → Cook Editor") would otherwise do
     * nothing. Route the file through the same flow Theia uses for CLI/second-instance
     * file arguments, so double-click behaves like launching the app with the file path.
     */
    protected override hookApplicationEvents(): void {
        super.hookApplicationEvents();
        if (process.platform === 'darwin') {
            app.on('open-file', (event, filePath) => {
                event.preventDefault();
                this.handleMainCommand({
                    file: filePath,
                    cwd: path.dirname(filePath),
                    secondInstance: true
                }).catch(error => console.error('Failed to open file from Finder:', error));
            });
        }
    }
```

- [ ] **Step 3: Compile the package**

Run: `npx lerna run compile --scope @theia/cooklang-branding`
Expected: completes with no TypeScript errors. If it errors that `handleMainCommand` /
`hookApplicationEvents` are not assignable or have wrong visibility, re-check the method
signatures against `node_modules/@theia/core/lib/electron-main/electron-main-application.d.ts`
(both are `protected`; `handleMainCommand(options: ElectronMainCommandOptions)` accepts
`{ file?, cwd, secondInstance }`).

- [ ] **Step 4: Lint**

Run: `npx lerna run lint --scope @theia/cooklang-branding`
Expected: passes with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cooklang-branding/src/electron-main/cooklang-electron-main-application.ts
git commit -m "feat(macos): open .cook/.menu files on Finder double-click (open-file event)"
```

---

## Task 3: Manual end-to-end verification on a packaged build

No code changes — this task confirms the feature actually works, since the behavior lives
in macOS LaunchServices/Quick Look and cannot be exercised by automated tests.

**Files:** none.

- [ ] **Step 1: Build and bundle the app**

Run: `cd app && npm run bundle`
Expected: completes; `src-gen/` and `lib/` are regenerated.

- [ ] **Step 2: Produce a local app bundle**

Run: `cd app && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir`
Expected: `app/dist/mac*/Cook Editor.app` exists.

- [ ] **Step 3: Register the bundle with LaunchServices**

Run:
```bash
cd app
APP=$(ls -d dist/mac*/*.app | head -1)
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$APP"
```
Expected: no output (success). This forces macOS to pick up the new UTIs/associations
without a re-login.

- [ ] **Step 4: Verify Quick Look preview**

Create a test file and preview it in Finder:
```bash
printf -- '---\ntitle: Test Recipe\n---\nAdd @eggs{2} to the #bowl{} and mix.\n' > ~/Desktop/quicklook-test.cook
```
In Finder, select `~/Desktop/quicklook-test.cook` and press Space.
Expected: the Quick Look panel shows the file's source text (YAML frontmatter + the
Cooklang line). Repeat with a `.menu` file:
```bash
printf -- '---\ntitle: Test Menu\n---\n[Starter]\n@@Soup\n' > ~/Desktop/quicklook-test.menu
```
Expected: source text shown on Space.

> If "No preview available" still shows, LaunchServices may not have refreshed — re-run
> Step 3, or log out/in. This is an OS cache issue, not a code defect (see spec caveats).

- [ ] **Step 5: Verify double-click opens the file**

While Cook Editor is NOT running, double-click `~/Desktop/quicklook-test.cook` in Finder.
Expected: Cook Editor launches and opens the file (cold-launch `open-file`).
Then, with Cook Editor already running, double-click `~/Desktop/quicklook-test.menu`.
Expected: the file opens in the already-running instance.

- [ ] **Step 6: Clean up test files**

Run: `rm -f ~/Desktop/quicklook-test.cook ~/Desktop/quicklook-test.menu`
Expected: files removed.

---

## Self-Review Notes

- **Spec coverage:** Part 1 (Quick Look UTIs) → Task 1 Steps 1-4. Part 2a (document
  types) → Task 1 (CFBundleDocumentTypes). Part 2b (`open-file` handler) → Task 2.
  Testing/verification + LaunchServices and cold-launch caveats → Task 3. All spec
  sections are covered.
- **Types:** `handleMainCommand({ file, cwd, secondInstance })` and the `protected`
  `hookApplicationEvents()` override match the signatures in
  `@theia/core/lib/electron-main/electron-main-application.d.ts` (verified during design).
- **No placeholders:** every step has concrete YAML/TS/commands and expected output.
