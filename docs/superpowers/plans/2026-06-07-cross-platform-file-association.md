# Windows + Linux File Association (and Linux Text Preview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cook Editor the default app that opens `.cook`/`.menu` files on Windows and Linux (double-click), and let GNOME Files (Sushi) preview their source on spacebar.

**Architecture:** Pure packaging config — no application code. Windows/Linux pass a double-clicked file to the app as `argv`, which Theia already opens via `handleMainCommand`. Add `fileAssociations` scoped under the `win:` and `linux:` blocks of `app/electron-builder.yml` (scoped per-platform so macOS's existing `extendInfo` is untouched). For Linux spacebar preview, ship a shared-mime-info XML declaring the types as `sub-class-of text/plain` and register it on `.deb` install via `afterInstall`/`afterRemove` scripts running `update-mime-database`.

**Tech Stack:** electron-builder (YAML), freedesktop shared-mime-info XML, POSIX sh maintainer scripts.

**Design spec:** `docs/superpowers/specs/2026-06-07-cross-platform-file-association-design.md`

> **Environment note:** This is a macOS dev box. Building the actual Windows NSIS and Linux `.deb` artifacts requires Windows / Linux environments and is done in **Task 3 (manual)**. Tasks 1-2 are config/file creation verified by static checks (YAML parse, `sh -n`, XML well-formedness).

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `app/electron-builder.yml` | Packaging config: per-platform `fileAssociations`, `extraResources` entry, `deb.afterInstall`/`afterRemove` | Modify |
| `app/resources/cooklang-mime.xml` | freedesktop MIME definition marking `.cook`/`.menu` as `sub-class-of text/plain` | Create |
| `build/linux/deb-after-install.sh` | Install MIME XML into `/usr/share/mime/packages/` and refresh databases | Create |
| `build/linux/deb-after-remove.sh` | Remove MIME XML and refresh the MIME database | Create |

No application/runtime code, no new packages, no macOS changes.

---

## Task 1: Windows + Linux file associations

Add `fileAssociations` under both the `win:` and `linux:` blocks. This is the
default-open half — portable with no code because Theia opens files passed on `argv`.

**Files:**
- Modify: `app/electron-builder.yml` (`win:` block ~lines 120-124, `linux:` block ~lines 140-146)

- [ ] **Step 1: Add `fileAssociations` to the `win:` block**

The `win:` block currently is:

```yaml
win:
  icon: resources/icon.ico
  target:
    - nsis
    - zip
```

Change it to (append `fileAssociations`, keep existing keys):

```yaml
win:
  icon: resources/icon.ico
  target:
    - nsis
    - zip
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

- [ ] **Step 2: Add `fileAssociations` to the `linux:` block**

The `linux:` block currently is:

```yaml
linux:
  icon: resources/icon-256.png
  category: Utility
  target:
    - AppImage
    - deb
    - tar.gz
```

Change it to (append `fileAssociations`, keep existing keys):

```yaml
linux:
  icon: resources/icon-256.png
  category: Utility
  target:
    - AppImage
    - deb
    - tar.gz
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

- [ ] **Step 3: Verify the YAML parses and associations are scoped per-platform**

Run from `/Users/alexeydubovskoy/Cooklang/editor`:

```bash
cd app && node -e "
const y=require('js-yaml');
const o=y.load(require('fs').readFileSync('electron-builder.yml','utf8'));
const win=(o.win.fileAssociations||[]).map(f=>f.ext+':'+(f.mimeType||'(no mime)'));
const lin=(o.linux.fileAssociations||[]).map(f=>f.ext+':'+f.mimeType);
if(o.mac && o.mac.fileAssociations){throw new Error('mac.fileAssociations must NOT be set')};
if(!o.mac || !o.mac.extendInfo){throw new Error('mac.extendInfo missing — did not preserve macOS work')};
console.log('win:', win.join(', '));
console.log('linux:', lin.join(', '));
console.log('mac.extendInfo preserved:', !!o.mac.extendInfo);
"
```

Expected output:
```
win: cook:(no mime), menu:(no mime)
linux: cook:text/x-cooklang, menu:text/x-cooklang-menu
mac.extendInfo preserved: true
```

(If the node command can't resolve `js-yaml` from `app/`, run it from the repo root — `js-yaml` is a transitive dependency of electron-builder.)

- [ ] **Step 4: Commit**

```bash
git add app/electron-builder.yml
git commit -m "feat(win,linux): register .cook/.menu file associations"
```

---

## Task 2: Linux spacebar preview (MIME subclass + deb scripts)

Make the Linux MIME types subclasses of `text/plain` so GNOME Sushi previews the source.
Ship the XML inside the app, and register it on `.deb` install via maintainer scripts.

**Files:**
- Create: `app/resources/cooklang-mime.xml`
- Create: `build/linux/deb-after-install.sh`
- Create: `build/linux/deb-after-remove.sh`
- Modify: `app/electron-builder.yml` (`extraResources` list ~lines 40-62, `deb:` block ~lines 151-156)

- [ ] **Step 1: Create the MIME definition**

Create `app/resources/cooklang-mime.xml` with exactly:

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

- [ ] **Step 2: Verify the XML is well-formed**

Run: `xmllint --noout app/resources/cooklang-mime.xml && echo "XML OK"`
Expected: prints `XML OK` (no error). `xmllint` ships with macOS. If it is unavailable,
use: `python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse('app/resources/cooklang-mime.xml'); print('XML OK')"`
Expected: prints `XML OK`.

- [ ] **Step 3: Create the deb after-install script**

Create `build/linux/deb-after-install.sh` with exactly:

```sh
#!/bin/sh
set -e
# Locate the MIME definition shipped inside the installed app tree (under /opt).
# Using `find` avoids hard-coding a path containing the space in the product name.
SRC="$(find /opt -maxdepth 4 -name cooklang-mime.xml 2>/dev/null | head -1)"
if [ -n "$SRC" ] && command -v update-mime-database >/dev/null 2>&1; then
    install -Dm644 "$SRC" /usr/share/mime/packages/cooklang.xml
    update-mime-database /usr/share/mime || true
fi
# Refresh the desktop application database so the file association is picked up.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi
```

- [ ] **Step 4: Create the deb after-remove script**

Create `build/linux/deb-after-remove.sh` with exactly:

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

- [ ] **Step 5: Make both scripts executable and verify their syntax**

Run from `/Users/alexeydubovskoy/Cooklang/editor`:

```bash
chmod +x build/linux/deb-after-install.sh build/linux/deb-after-remove.sh
sh -n build/linux/deb-after-install.sh && sh -n build/linux/deb-after-remove.sh && echo "SH SYNTAX OK"
test -x build/linux/deb-after-install.sh && test -x build/linux/deb-after-remove.sh && echo "EXECUTABLE OK"
```

Expected: prints `SH SYNTAX OK` then `EXECUTABLE OK`.

- [ ] **Step 6: Ship the XML as an extra resource**

In `app/electron-builder.yml`, the `extraResources:` list currently ends with:

```yaml
  - from: ../NOTICE.md
    to: licenses/NOTICE.md
```

Add a new entry immediately after it (same indentation, still inside `extraResources:`):

```yaml
  - from: resources/cooklang-mime.xml
    to: cooklang-mime.xml
```

- [ ] **Step 7: Wire the maintainer scripts into the `deb:` block**

The `deb:` block currently is:

```yaml
deb:
  artifactName: Cook-Editor.${ext}
  depends:
    - libnotify4
    - libxtst6
    - libnss3
```

Change it to (append the two script keys, keep existing keys):

```yaml
deb:
  artifactName: Cook-Editor.${ext}
  depends:
    - libnotify4
    - libxtst6
    - libnss3
  afterInstall: build/linux/deb-after-install.sh
  afterRemove: build/linux/deb-after-remove.sh
```

- [ ] **Step 8: Verify the YAML still parses with the new keys**

Run from `/Users/alexeydubovskoy/Cooklang/editor`:

```bash
cd app && node -e "
const y=require('js-yaml');
const o=y.load(require('fs').readFileSync('electron-builder.yml','utf8'));
const hasRes=(o.extraResources||[]).some(r=>r.from==='resources/cooklang-mime.xml');
if(!hasRes){throw new Error('extraResources entry for cooklang-mime.xml missing')};
if(o.deb.afterInstall!=='build/linux/deb-after-install.sh'){throw new Error('deb.afterInstall not set')};
if(o.deb.afterRemove!=='build/linux/deb-after-remove.sh'){throw new Error('deb.afterRemove not set')};
console.log('extraResources + deb scripts wired OK');
"
```

Expected output: `extraResources + deb scripts wired OK`

- [ ] **Step 9: Commit**

```bash
git add app/electron-builder.yml app/resources/cooklang-mime.xml build/linux/deb-after-install.sh build/linux/deb-after-remove.sh
git commit -m "feat(linux): enable GNOME spacebar text preview for .cook/.menu via MIME subclass"
```

---

## Task 3: Manual cross-platform verification

No code changes — confirms behavior on real OSes (cannot be tested on the macOS dev box).

**Files:** none.

- [ ] **Step 1: Windows — build the installer**

On a Windows machine (or Windows VM) with the repo checked out and deps installed:
Run: `cd app && npm run bundle && npx electron-builder --win nsis`
Expected: produces `app/dist/Cook-Editor-Setup.exe`.

- [ ] **Step 2: Windows — install and test association**

Install the produced `.exe`. In File Explorer, create a test file `test.cook` containing
a couple of lines of text, then double-click it.
Expected: Cook Editor launches and opens `test.cook`. Repeat with a `test.menu` file.
Expected: the files show the Cook Editor icon in Explorer.

- [ ] **Step 3: Linux — build the deb**

On a Linux machine (or VM) with GNOME, repo checked out and deps installed:
Run: `cd app && npm run bundle && npx electron-builder --linux deb`
Expected: produces `app/dist/Cook-Editor.deb`.

- [ ] **Step 4: Linux — install and verify MIME registration**

```bash
sudo apt install ./app/dist/Cook-Editor.deb
gio mime text/x-cooklang
test -f /usr/share/mime/packages/cooklang.xml && echo "mime xml installed"
```
Expected: `/usr/share/mime/packages/cooklang.xml` exists; `gio mime text/x-cooklang`
reports Cook Editor as the default handler.

- [ ] **Step 4b: Linux — verify the app is on PATH and launches**

The deb maintainer scripts override electron-builder's defaults, so confirm the default
behavior they incorporate still works (PATH symlink, chrome-sandbox, AppArmor):

```bash
which cook-editor   # or the executable name from: dpkg -L <pkg> | grep /usr/bin
cook-editor &       # should launch the app window, then close it
```
Expected: `which` prints `/usr/bin/cook-editor` (the `update-alternatives`/symlink from
the after-install script), and launching from the terminal opens the app without a
chrome-sandbox or AppArmor error.

- [ ] **Step 5: Linux — verify content-type and text inheritance**

```bash
printf -- '---\ntitle: Test\n---\nAdd @eggs{2} to the #bowl{}.\n' > ~/test.cook
gio info ~/test.cook | grep content-type
```
Expected: `standard::content-type: text/x-cooklang`. (The type inherits `text/plain` per
the shipped MIME XML, which is what enables text preview.)

- [ ] **Step 6: Linux — verify association and spacebar preview in GNOME Files**

Open `~` in GNOME Files (Nautilus). Double-click `test.cook`.
Expected: Cook Editor opens it. Then select `test.cook` and press Space.
Expected: GNOME Sushi shows the file's source text.

- [ ] **Step 7: Linux — verify clean removal**

```bash
sudo apt remove cook-editor   # or the package name reported by: dpkg -l | grep -i cook
test -f /usr/share/mime/packages/cooklang.xml && echo "STILL PRESENT (bug)" || echo "removed OK"
```
Expected: prints `removed OK` (the after-remove script deleted the MIME XML).

- [ ] **Step 8: Clean up test files**

Run (on each platform used): remove the `test.cook` / `test.menu` files created above.

---

## Self-Review Notes

- **Spec coverage:** Part W (Windows association) → Task 1 Steps 1,3-4 + Task 3 Steps 1-2.
  Part L1 (Linux association) → Task 1 Steps 2-4 + Task 3 Steps 3-4,6. Part L2 (Linux
  preview) → Task 2 (XML + scripts + wiring) + Task 3 Steps 5-7. Testing/verification →
  Task 3. Scope limitations are inherent (deb/GNOME only) and surfaced in Task 3’s targets.
- **MIME type consistency:** `text/x-cooklang` (`.cook`) and `text/x-cooklang-menu`
  (`.menu`) are identical across the `linux.fileAssociations` mimeType (Task 1 Step 2),
  the shipped XML (Task 2 Step 1), and the verification commands (Task 3 Steps 4-5).
- **No placeholders:** every step has concrete YAML/XML/sh content and expected output.
- **macOS safety:** Task 1 Step 3 asserts `mac.extendInfo` is preserved and
  `mac.fileAssociations` is absent, guarding against regressing the merged macOS work.
