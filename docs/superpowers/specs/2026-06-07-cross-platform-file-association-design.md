# Windows + Linux file association (and Linux text preview) for `.cook` / `.menu`

**Date:** 2026-06-07
**Status:** Approved design — pending implementation plan

## Goal

Extend the macOS Quick Look / file-association work (see
`2026-06-06-quicklook-cook-menu-preview-design.md`) to the other desktop platforms:

- **Windows:** Cook Editor is the default app that opens `.cook` / `.menu` on
  double-click.
- **Linux:** same default-open association, plus a source-text preview on spacebar in
  GNOME Files (Sushi).

The macOS implementation is already merged/open separately and is **not** modified here.

## Why "the same" is only partially portable

The macOS feature had two halves: file association (double-click opens) and Quick Look
preview (spacebar). Their portability differs:

- **File association** is portable and cheap. Windows passes a double-clicked file to the
  app as an `argv` argument; Linux file managers do the same. Theia's Electron main
  process already opens a file given on `argv` — `start()` parses a `[file]` positional and
  calls `handleMainCommand({ file, cwd, secondInstance: false })`
  (`@theia/core/lib/electron-main/electron-main-application.js:156`), and
  `onSecondInstance` does the same when the app is already running. So **no application
  code is needed** for double-click-open on Windows or Linux — only packaging metadata.
- **Spacebar preview** is macOS-specific UX:
  - **Windows** has no spacebar preview in Explorer. The nearest analog is the Preview
    Pane (Alt+P), which requires a native `IPreviewHandler` COM shell extension (C++/.NET,
    registry-registered) — out of scope: heavy, non-Electron, low payoff.
  - **Linux** has spacebar preview only in GNOME Files via **Sushi** (and varies by
    desktop environment). Sushi picks a previewer by MIME type; declaring our type a
    **subclass of `text/plain`** makes it use the text previewer — the Linux analog of
    macOS's `public.plain-text` conformance.

## electron-builder behavior (verified in `app-builder-lib`)

- `fileAssociations` is read **per platform**: the effective list is
  `config.fileAssociations` concatenated with `platformSpecificBuildOptions.fileAssociations`
  (`platformPackager.js:578`). So putting `fileAssociations` under `win:` / `linux:` keeps
  them off macOS. macOS only merges `mac.extendInfo` into its plist
  (`macPackager.js:473`), so the existing macOS work is untouched.
- For Linux, electron-builder auto-generates a MIME XML
  (`LinuxTargetHelper.computeMimeTypeFiles`) containing only `<glob>`, `<comment>`, and
  `<icon>` — **no `<sub-class-of>`** — and installs it (for `deb`/fpm targets) to
  `/usr/share/mime/packages/<executableName>.xml` (`FpmTarget.js:196`). It also adds each
  association's `mimeType` to the generated `.desktop` `MimeType=` key
  (`LinuxTargetHelper.js:139`).
- `update-mime-database` **unions** all definitions across files in
  `/usr/share/mime/packages/`. So an additional XML that declares only
  `<sub-class-of type="text/plain"/>` for the same MIME type augments (does not replace)
  electron-builder's generated glob definition. This is the mechanism Part L2 relies on.

## MIME types

- `.cook` → `text/x-cooklang`
- `.menu` → `text/x-cooklang-menu`

Both declared `<sub-class-of type="text/plain"/>` (Part L2).

## Part W — Windows file association

Add a `fileAssociations` array under the **`win:`** block in `app/electron-builder.yml`:

```yaml
win:
  # ...existing keys...
  fileAssociations:
    - ext: cook
      name: Cooklang Recipe
      description: Cooklang Recipe
      icon: resources/icon.ico
    - ext: menu
      name: Cooklang Menu
      description: Cooklang Menu
      icon: resources/icon.ico
```

The NSIS installer registers the extensions to the app. On double-click, Windows launches
Cook Editor with the file path as `argv`, which Theia already opens. **No code changes.**

Note: registration is per-user (HKCU) under the current assisted NSIS config
(`oneClick: false`), which is fine. The existing `cook://` protocol registration is
independent and unaffected.

## Part L1 — Linux file association

Add a `fileAssociations` array under the **`linux:`** block, with MIME types:

```yaml
linux:
  # ...existing keys...
  fileAssociations:
    - ext: cook
      name: Cooklang Recipe
      description: Cooklang Recipe
      mimeType: text/x-cooklang
    - ext: menu
      name: Cooklang Menu
      description: Cooklang Menu
      mimeType: text/x-cooklang-menu
```

electron-builder writes `text/x-cooklang;text/x-cooklang-menu;` into the generated
`.desktop` `MimeType=` key and ships a glob MIME definition. On the **`.deb`** package this
gives full desktop integration (default-open via `argv`). **AppImage and tar.gz do not
install system files, so they will not auto-register** — documented limitation.

## Part L2 — Linux spacebar preview (GNOME)

Make the MIME types subclasses of `text/plain` so GNOME Sushi previews the source.

1. **Add `app/resources/cooklang-mime.xml`:**

```xml
<?xml version="1.0" encoding="utf-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="text/x-cooklang">
    <comment>Cooklang Recipe</comment>
    <sub-class-of type="text/plain"/>
    <glob pattern="*.cook"/>
  </mime-type>
  <mime-type type="text/x-cooklang-menu">
    <comment>Cooklang Menu</comment>
    <sub-class-of type="text/plain"/>
    <glob pattern="*.menu"/>
  </mime-type>
</mime-info>
```

2. **Ship it as an extra resource** so it lands inside the installed app tree
   (`/opt/<productName>/resources/cooklang-mime.xml`). Add to `extraResources` in
   `app/electron-builder.yml`:

```yaml
extraResources:
  # ...existing entries...
  - from: resources/cooklang-mime.xml
    to: cooklang-mime.xml
```

   (Installed location resolves under the app's `resources/` directory; the exact absolute
   path is computed in the post-install script — see step 3.)

3. **Register it on install via deb scripts.** Add to the `deb:` block:

```yaml
deb:
  # ...existing keys...
  afterInstall: build/linux/deb-after-install.sh
  afterRemove: build/linux/deb-after-remove.sh
```

   `build/linux/deb-after-install.sh`:

```sh
#!/bin/sh
set -e
# Locate the shipped MIME definition within the installed app tree.
SRC="$(find /opt -maxdepth 4 -name cooklang-mime.xml 2>/dev/null | head -1)"
if [ -n "$SRC" ] && command -v update-mime-database >/dev/null 2>&1; then
    install -Dm644 "$SRC" /usr/share/mime/packages/cooklang.xml
    update-mime-database /usr/share/mime || true
fi
# Refresh the desktop application database so the association is picked up.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi
```

   `build/linux/deb-after-remove.sh`:

```sh
#!/bin/sh
set -e
if [ -f /usr/share/mime/packages/cooklang.xml ]; then
    rm -f /usr/share/mime/packages/cooklang.xml
    if command -v update-mime-database >/dev/null 2>&1; then
        update-mime-database /usr/share/mime || true
    fi
fi
```

   After `update-mime-database` runs, the merged definition for each type has both the
   glob (from electron-builder's generated XML) and `<sub-class-of type="text/plain"/>`
   (from ours). GNOME Sushi then previews `.cook` / `.menu` as text on spacebar.

## Files touched

| File | Change |
| --- | --- |
| `app/electron-builder.yml` | `win.fileAssociations`, `linux.fileAssociations`, `extraResources` entry, `deb.afterInstall` / `deb.afterRemove` |
| `app/resources/cooklang-mime.xml` | New — MIME definition with `sub-class-of text/plain` |
| `build/linux/deb-after-install.sh` | New — install MIME XML + refresh databases |
| `build/linux/deb-after-remove.sh` | New — remove MIME XML + refresh database |

No application/runtime code changes. No new packages. No macOS changes. Entitlements and
notarization unaffected.

## Testing & verification

- **Static:** YAML still parses; the two shell scripts pass `sh -n` (syntax check) and are
  executable; the XML is well-formed (`xmllint --noout` if available).
- **Windows (manual, on a Windows box/VM):** build NSIS (`electron-builder --win nsis`),
  install, double-click a `.cook` and a `.menu` file → Cook Editor opens each. Confirm the
  files show the app icon in Explorer.
- **Linux (manual, GNOME VM/container):** build `.deb` (`electron-builder --linux deb`),
  install with `apt install ./<pkg>.deb`, then:
  - double-click a `.cook`/`.menu` in Files → Cook Editor opens it;
  - select the file and press Space → Sushi shows the source text.
  - `gio info quicklook-test.cook` should report `standard::content-type: text/x-cooklang`
    and the type should inherit `text/plain` (`gio mime text/x-cooklang`).

## Caveats / known risks

- **deb-only desktop integration:** AppImage and tar.gz neither register the association
  nor enable preview automatically (no system-file install). Accepted.
- **GNOME-only preview:** spacebar preview depends on GNOME Sushi. KDE Dolphin and other
  file managers may show the association but preview behavior varies; not targeted.
- **`/opt` discovery in the post-install script:** the script `find`s `cooklang-mime.xml`
  under `/opt` rather than hard-coding `/opt/Cook Editor/resources/...`, avoiding fragility
  from the space in the product name and any install-dir differences.
- **Mime cache timing:** as on macOS, the file manager may need a restart (or
  `update-mime-database` to finish) before the new type/preview is recognized.

## Out of scope (possible future phases)

- Native Windows `IPreviewHandler` (Preview Pane) and `IThumbnailProvider` (thumbnails).
- Dedicated `.cook` / `.menu` document icons (this pass reuses the app icon).
- KDE/other-DE preview integration.
- Rendered (formatted) previews on any platform — these remain raw-source only.
