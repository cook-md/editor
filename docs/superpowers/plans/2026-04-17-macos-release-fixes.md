# macOS Release Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Intel Mac dyld crash and enable code signing + notarization for macOS releases so unsigned-Gatekeeper-blocked and framework-missing crashes both stop happening.

**Architecture:** Three independent config changes — (1) narrow electron-builder's asar-unpack rule and add negative file globs to stop `packages/cooklang-native/target/` shipping (1.3 GB of Cargo build cache was overflowing `hdiutil`'s auto-sized DMG and causing the Electron Framework binary to be silently dropped); (2) contingency DMG size override if (1) is insufficient; (3) Apple Developer ID signing + notarytool via electron-builder's built-in `notarize: true` flow, driven by GitHub Actions secrets.

**Tech Stack:** electron-builder 26.x, GitHub Actions, Apple `notarytool`, `hdiutil`, bash for local verification.

**Spec:** `docs/superpowers/specs/2026-04-17-macos-release-fixes-design.md`

---

## Context for the engineer

- The repo is an Electron-only Theia fork. Release artifacts are produced by `.github/workflows/release.yml` which runs on `macos-latest` (arm64 since late 2024) and cross-compiles an x64 variant on that arm64 runner.
- Local bundling: `cd examples/electron && npm run bundle` produces `src-gen/` + `lib/`. Then `npx electron-builder --mac` produces `dist/*.dmg` and `dist/*.zip`.
- The user runs this on an **Intel Mac** (x64 host), so `electron-builder --mac` defaults to a native x64 build — no cross-compile locally.
- The native Cargo build cache (`packages/cooklang-native/target/`) lives on disk in the workspace. Lerna symlinks `packages/cooklang-native` into `node_modules/@theia/cooklang-native` at install time. When electron-builder copies `node_modules` into the bundle, it follows the symlink and copies the whole workspace directory, including `target/`.
- PR 1 (Fix 1) is small enough to merge + tag + release without signing; users will still need `xattr -cr` to launch, but they won't crash.
- PR 2 (Fix 3) lands signing + notarization, at which point users can install and launch normally.

---

## Task 1: Add local DMG verification script

**Why first:** gives us a failing test for Fix 1 before we change any config. TDD applied to build config.

**Files:**
- Create: `examples/electron/scripts/verify-mac-bundle.sh`

- [ ] **Step 1: Create the verification script**

Create `examples/electron/scripts/verify-mac-bundle.sh`:

```bash
#!/usr/bin/env bash
# Verifies the macOS .app bundle inside a built DMG has:
#   - the Electron Framework binary present (not dropped by hdiutil)
#   - no Cargo build cache from packages/cooklang-native
#   - the cooklang-native .node addon present
#
# Usage: ./scripts/verify-mac-bundle.sh dist/CookEd-x64.dmg
set -euo pipefail

DMG="${1:-}"
if [ -z "$DMG" ] || [ ! -f "$DMG" ]; then
    echo "usage: $0 <path-to-dmg>" >&2
    exit 2
fi

MOUNT_POINT=$(mktemp -d -t cooked-verify)
trap 'hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true; rm -rf "$MOUNT_POINT"' EXIT

hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT_POINT" -quiet

APP="$MOUNT_POINT/CookEd.app"
if [ ! -d "$APP" ]; then
    echo "FAIL: CookEd.app not found in DMG" >&2
    exit 1
fi

fail=0

FRAMEWORK_BIN="$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
if [ ! -f "$FRAMEWORK_BIN" ]; then
    echo "FAIL: Electron Framework binary missing: $FRAMEWORK_BIN" >&2
    fail=1
else
    file "$FRAMEWORK_BIN" | grep -q "Mach-O" || { echo "FAIL: Framework is not Mach-O" >&2; fail=1; }
    echo "OK: Electron Framework binary present ($(du -h "$FRAMEWORK_BIN" | cut -f1))"
fi

TARGET_DIR="$APP/Contents/Resources/app.asar.unpacked/node_modules/@theia/cooklang-native/target"
if [ -d "$TARGET_DIR" ]; then
    echo "FAIL: Cargo target/ cache shipped in bundle: $TARGET_DIR" >&2
    echo "       size: $(du -sh "$TARGET_DIR" | cut -f1)" >&2
    fail=1
else
    echo "OK: no Cargo target/ cache in bundle"
fi

NODE_ADDON=$(find "$APP/Contents/Resources/app.asar.unpacked/node_modules/@theia/cooklang-native" -name "*.node" 2>/dev/null | head -1)
if [ -z "$NODE_ADDON" ] || [ ! -f "$NODE_ADDON" ]; then
    echo "FAIL: cooklang-native .node addon not found in bundle" >&2
    fail=1
else
    echo "OK: cooklang-native .node addon present ($(basename "$NODE_ADDON"))"
fi

APP_SIZE_MB=$(du -sm "$APP" | cut -f1)
if [ "$APP_SIZE_MB" -gt 1000 ]; then
    echo "FAIL: .app size is ${APP_SIZE_MB} MB — expected < 1000 MB after bundle cleanup" >&2
    fail=1
else
    echo "OK: .app size is ${APP_SIZE_MB} MB"
fi

if [ "$fail" -ne 0 ]; then
    exit 1
fi
echo "ALL CHECKS PASSED"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x examples/electron/scripts/verify-mac-bundle.sh
```

- [ ] **Step 3: Run it against the CURRENT broken release to confirm it correctly detects the bug**

```bash
cd /tmp && gh release download v0.1.0-alpha.0 --repo cook-md/editor --pattern "CookEd-x64.dmg" -D /tmp/cooked-verify
/Users/alexeydubovskoy/Cooklang/editor/examples/electron/scripts/verify-mac-bundle.sh /tmp/cooked-verify/CookEd-x64.dmg
```

Expected: **FAIL** with messages:
- `FAIL: Electron Framework binary missing: ...`
- `FAIL: Cargo target/ cache shipped in bundle: ...`
- `FAIL: .app size is ~1800 MB — expected < 1000 MB after bundle cleanup`

Exit code: 1.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add examples/electron/scripts/verify-mac-bundle.sh
git commit -m "build(mac): add verify-mac-bundle.sh for release DMG checks

Verifies Electron Framework binary is present, Cargo target cache
is not shipped, cooklang-native .node addon is present, and total
.app size is sane.

Currently fails against v0.1.0-alpha.0 — used to drive the fix."
```

---

## Task 2: Fix 1 — Narrow asarUnpack and exclude Rust cache

**Files:**
- Modify: `examples/electron/electron-builder.yml`

- [ ] **Step 1: Apply the config change**

Edit `examples/electron/electron-builder.yml`.

Current `asarUnpack` block (lines ~8-11):
```yaml
asar: true
asarUnpack:
  - "**/*.node"
  - "**/cooklang-native/**"
```

Change to:
```yaml
asar: true
asarUnpack:
  - "**/*.node"
```

Current `files:` block (lines ~21-27):
```yaml
files:
  - src-gen
  - lib
  - resources/icon-256.png
  - resources/cooked-logo.svg
  - "!node_modules/**/@theia/**/src/**"
  - "!node_modules/**/@theia/**/lib/**/*.spec.*"
```

Change to:
```yaml
files:
  - src-gen
  - lib
  - resources/icon-256.png
  - resources/cooked-logo.svg
  - "!node_modules/**/@theia/**/src/**"
  - "!node_modules/**/@theia/**/lib/**/*.spec.*"
  - "!node_modules/**/@theia/cooklang-native/target/**"
  - "!node_modules/**/@theia/cooklang-native/Cargo.*"
  - "!node_modules/**/@theia/cooklang-native/build.rs"
  - "!node_modules/**/@theia/cooklang-native/src/**"
```

- [ ] **Step 2: Make sure the native addon for the local host arch is built**

The user is on Intel Mac (x64). Ensure the `.node` file is built for x64:

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/packages/cooklang-native
npm run build
ls -la *.node
file cooklang-native.darwin-*.node
```

Expected: one `*.node` file, `file` reports `Mach-O 64-bit ... x86_64`.

- [ ] **Step 3: Bundle the Electron app**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/examples/electron
npm run bundle
```

Expected: completes without errors. Emits `src-gen/` and `lib/`.

- [ ] **Step 4: Build the DMG locally**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/examples/electron
rm -rf dist
npx electron-builder --mac --x64 --publish never
```

Expected: completes, emits `dist/CookEd-x64.dmg` and `dist/CookEd-0.1.0-alpha.0-mac.zip` (or similar).

- [ ] **Step 5: Run the verification script against the new DMG**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/examples/electron
./scripts/verify-mac-bundle.sh dist/CookEd-x64.dmg
```

Expected: **ALL CHECKS PASSED**, exit code 0.

If it FAILS with "Electron Framework binary missing" despite the bundle being under 1 GB, jump to Task 3 (Fix 2 contingency). If it passes, continue.

- [ ] **Step 6: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add examples/electron/electron-builder.yml
git commit -m "fix(build): stop shipping Cargo target cache in macOS bundle

packages/cooklang-native/target/ was 1.3 GB of Rust build
intermediates (rlibs, rmetas, incremental cache) getting dragged
into the Electron app via lerna symlinks. The bundle was 2.0 GB,
and hdiutil's auto-sized DMG silently dropped the 190 MB Electron
Framework binary when it overflowed — causing Intel Mac installs
to crash at launch with a dyld error.

Narrows asarUnpack to just *.node and adds negative files globs
for target/, Cargo.*, build.rs, and src/ under cooklang-native.

Expected bundle size post-fix: ~700 MB (from ~2 GB).
Fixes the Intel Mac dyld crash reported in v0.1.0-alpha.0."
```

---

## Task 3 (CONDITIONAL): Fix 2 — Explicit DMG size

**Only execute this task if Task 2 Step 5 failed** with "Electron Framework binary missing" AND the total .app size was under 1 GB. If Task 2 passed, skip to Task 4.

**Files:**
- Modify: `examples/electron/electron-builder.yml`

- [ ] **Step 1: Add explicit DMG sizing**

Edit `examples/electron/electron-builder.yml`. Current `dmg:` block:
```yaml
dmg:
  sign: false
  artifactName: ${productName}-${arch}.${ext}
```

Change to:
```yaml
dmg:
  sign: false
  artifactName: ${productName}-${arch}.${ext}
  # hdiutil auto-sizing has been observed to drop files when close to
  # capacity. Give it 200 MB of headroom above the computed content size.
  additionalSize: 200
```

- [ ] **Step 2: Rebuild DMG**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor/examples/electron
rm -rf dist
npx electron-builder --mac --x64 --publish never
```

- [ ] **Step 3: Re-run verification**

```bash
./scripts/verify-mac-bundle.sh dist/CookEd-x64.dmg
```

Expected: **ALL CHECKS PASSED**.

- [ ] **Step 4: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add examples/electron/electron-builder.yml
git commit -m "fix(build): force 200 MB DMG headroom to prevent hdiutil drops

Follow-up to bundle-hygiene fix. hdiutil's auto-computed DMG size
was still dropping the Electron Framework binary on some arch
combinations. Explicit additionalSize: 200 guarantees headroom."
```

---

## Task 4: Verify Fix 1 locally on Intel Mac

**Files:** none (verification step).

- [ ] **Step 1: Install the built DMG**

```bash
open /Users/alexeydubovskoy/Cooklang/editor/examples/electron/dist/CookEd-x64.dmg
```

Drag `CookEd.app` to `/Applications`.

- [ ] **Step 2: Bypass Gatekeeper (since we haven't signed yet)**

```bash
xattr -cr /Applications/CookEd.app
```

- [ ] **Step 3: Launch and observe**

```bash
open /Applications/CookEd.app
```

Expected: the app window opens. No `Library not loaded: @rpath/Electron Framework.framework/Electron Framework` dialog.

If the app still crashes at launch, capture the crash report from `~/Library/Logs/DiagnosticReports/CookEd-*.crash` and stop — we have a different root cause than assumed.

- [ ] **Step 4: Push the Fix 1 PR**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git push origin HEAD
gh pr create --title "fix(build): Intel Mac crash — exclude Cargo cache from bundle" --body "$(cat <<'EOF'
## Summary
- Narrows `asarUnpack` to just `**/*.node`, dropping the broad `**/cooklang-native/**` glob that was pulling the entire Cargo build cache (1.3 GB) into the app bundle.
- Adds negative `files:` globs for `target/`, `Cargo.*`, `build.rs`, and `src/` under `cooklang-native` as defence-in-depth.
- Adds `scripts/verify-mac-bundle.sh` to catch this class of regression locally and in CI.

## Root cause
Lerna symlinks `packages/cooklang-native/` into `node_modules/@theia/cooklang-native/` at install time. electron-builder follows the symlink and copies the whole workspace directory — including Cargo's `target/` — into the `.app`. Combined with `asarUnpack: **/cooklang-native/**`, all 1.3 GB stayed unpacked. The oversized bundle overflowed `hdiutil`'s auto-computed DMG size, and the largest file (the 190 MB `Electron Framework` binary) was silently dropped during DMG creation.

Result: Intel Mac users crashed at launch with `Library not loaded: @rpath/Electron Framework.framework/Electron Framework`.

See `docs/superpowers/specs/2026-04-17-macos-release-fixes-design.md` for full diagnosis.

## Test plan
- [x] `verify-mac-bundle.sh` fails against `v0.1.0-alpha.0` DMG (Framework missing, target shipped, 1.8 GB size)
- [x] `verify-mac-bundle.sh` passes against locally-built DMG after this change
- [x] Installed locally on Intel Mac, `xattr -cr`, app launches without dyld error
- [ ] Cut `v0.1.0-alpha.1` tag; confirm CI-produced `CookEd-x64.dmg` passes `verify-mac-bundle.sh`
EOF
)"
```

---

## Task 5: Cut alpha tag and verify CI-built artifact

**Files:** none (release step).

- [ ] **Step 1: After Fix 1 PR merges, tag a new alpha**

```bash
git checkout main
git pull
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

CI runs automatically on tag push. Watch at https://github.com/cook-md/editor/actions.

- [ ] **Step 2: After all matrix jobs complete, download the x64 DMG**

```bash
mkdir -p /tmp/cooked-alpha1
cd /tmp/cooked-alpha1
gh release download v0.1.0-alpha.1 --repo cook-md/editor --pattern "CookEd-x64.dmg"
```

- [ ] **Step 3: Run verification on CI-built artifact**

```bash
/Users/alexeydubovskoy/Cooklang/editor/examples/electron/scripts/verify-mac-bundle.sh /tmp/cooked-alpha1/CookEd-x64.dmg
```

Expected: **ALL CHECKS PASSED**.

---

## Task 6: Provision Apple Developer secrets in GitHub

**Files:** none (GitHub Settings UI).

**Prerequisite:** you already have the Developer ID Application `.p12`, Apple ID, app-specific password, and Team ID (user has confirmed).

- [ ] **Step 1: Base64-encode the .p12 certificate**

On the Mac where the `.p12` lives:
```bash
base64 -i /path/to/DeveloperIDApplication.p12 | pbcopy
```

The base64 is now in your clipboard.

- [ ] **Step 2: Add five repository secrets**

Navigate to https://github.com/cook-md/editor/settings/secrets/actions and add these with "New repository secret":

| Name | Value |
|------|-------|
| `MAC_CSC_LINK` | paste from clipboard (base64 of .p12) |
| `MAC_CSC_KEY_PASSWORD` | password for the .p12 file |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | `xxxx-xxxx-xxxx-xxxx` format |
| `APPLE_TEAM_ID` | 10-character Team ID |

- [ ] **Step 3: Verify secrets are listed**

```bash
gh secret list --repo cook-md/editor
```

Expected: all five names listed (values are never shown).

---

## Task 7: Fix 3a — Wire secrets into release workflow

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add env vars to the Package & Publish step**

Edit `.github/workflows/release.yml`. Current "Package & Publish" step env (lines ~133-135):
```yaml
        env:
          GH_TOKEN: ${{ secrets.PUBLIC_REPO_PAT }}
```

Change to:
```yaml
        env:
          GH_TOKEN: ${{ secrets.PUBLIC_REPO_PAT }}
          # Code signing — electron-builder reads these automatically on macOS.
          # Harmless on Windows/Linux matrix rows (ignored).
          CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
          # Notarization — electron-builder reads these when mac.notarize is true
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add .github/workflows/release.yml
git commit -m "ci(release): expose Apple signing + notarization secrets

electron-builder reads CSC_LINK/CSC_KEY_PASSWORD for signing and
APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID for notarytool.
Env vars are harmless on Windows/Linux matrix rows."
```

---

## Task 8: Fix 3b — Enable notarization and DMG signing

**Files:**
- Modify: `examples/electron/electron-builder.yml`

- [ ] **Step 1: Turn on notarize and DMG signing**

Edit `examples/electron/electron-builder.yml`.

Current `mac:` block (bottom — after entitlements):
```yaml
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```

Change to:
```yaml
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  # Submit to Apple's notarytool after signing; uses APPLE_* env vars.
  notarize: true
```

Current `dmg:` block:
```yaml
dmg:
  sign: false
  artifactName: ${productName}-${arch}.${ext}
```

Change `sign: false` to `sign: true`:
```yaml
dmg:
  sign: true
  artifactName: ${productName}-${arch}.${ext}
```

(If Task 3 was executed, keep the `additionalSize: 200` line as well.)

- [ ] **Step 2: Commit**

```bash
cd /Users/alexeydubovskoy/Cooklang/editor
git add examples/electron/electron-builder.yml
git commit -m "feat(build): enable macOS code signing and notarization

mac.notarize: true triggers electron-builder's notarytool submission
using the APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID env
vars injected by the release workflow. dmg.sign: true ensures the
DMG wrapper is also signed (app inside was already signed via
hardenedRuntime)."
```

- [ ] **Step 3: Open PR**

```bash
git push origin HEAD
gh pr create --title "feat(build): enable macOS signing + notarization" --body "$(cat <<'EOF'
## Summary
- Wires `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets into the release workflow.
- Sets `mac.notarize: true` and `dmg.sign: true` in `electron-builder.yml`.
- After this lands, releases are signed with our Developer ID Application cert and stapled with a notarytool ticket.

## Dependencies
Depends on the five GitHub Secrets being provisioned (see `docs/superpowers/plans/2026-04-17-macos-release-fixes.md` Task 6).

## Test plan
- [ ] Cut `v0.1.0-alpha.2` after merge
- [ ] Download DMG from release assets
- [ ] `spctl --assess --type execute --verbose=4 /Applications/CookEd.app` → `accepted`
- [ ] `codesign --verify --deep --strict --verbose=4 /Applications/CookEd.app` → `valid on disk`
- [ ] `xcrun stapler validate /Applications/CookEd.app` → `The validate action worked!`
- [ ] Install clean on Intel Mac — no `xattr -cr` needed — double-click launches
EOF
)"
```

---

## Task 9: Cut signed alpha tag and verify notarization

**Files:** none (release + verification step).

- [ ] **Step 1: Tag and push**

After Fix 3 PR merges:
```bash
git checkout main
git pull
git tag v0.1.0-alpha.2
git push origin v0.1.0-alpha.2
```

Monitor CI. The Package & Publish step on the macOS matrix rows will now include a notarization submission — expect it to take 2–10 minutes longer than alpha.1.

- [ ] **Step 2: Download and install the signed DMG**

```bash
mkdir -p /tmp/cooked-alpha2 && cd /tmp/cooked-alpha2
gh release download v0.1.0-alpha.2 --repo cook-md/editor --pattern "CookEd-x64.dmg"
open CookEd-x64.dmg
```

Drag to `/Applications`. **Do NOT run `xattr -cr`.**

- [ ] **Step 3: Validate signing + notarization**

```bash
spctl --assess --type execute --verbose=4 /Applications/CookEd.app 2>&1
```
Expected output includes: `accepted`, `source=Notarized Developer ID`.

```bash
codesign --verify --deep --strict --verbose=4 /Applications/CookEd.app 2>&1
```
Expected: `valid on disk`, `satisfies its Designated Requirement`.

```bash
xcrun stapler validate /Applications/CookEd.app
```
Expected: `The validate action worked!`.

- [ ] **Step 4: Launch from Finder**

Double-click `CookEd` in `/Applications`. Expected: no Gatekeeper dialog, app launches cleanly.

- [ ] **Step 5: Confirm Fix 1 is still holding**

```bash
/Users/alexeydubovskoy/Cooklang/editor/examples/electron/scripts/verify-mac-bundle.sh /tmp/cooked-alpha2/CookEd-x64.dmg
```

Expected: **ALL CHECKS PASSED**.

---

## Self-Review Notes

- **Spec coverage:** Fix 1 → Tasks 1, 2, 4, 5. Fix 2 (contingency) → Task 3. Fix 3 → Tasks 6, 7, 8, 9. All spec sections mapped.
- **Placeholders:** none.
- **Type consistency:** secret names used in Task 6 match env var names used in Task 7 (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
- **Commands are absolute-path or explicit `cd` where needed** — the engineer can paste them verbatim.
