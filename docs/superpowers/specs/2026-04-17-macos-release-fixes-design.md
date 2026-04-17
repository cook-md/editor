# macOS Release Fixes: Intel Mac Crash + Notarization

**Date:** 2026-04-17
**Status:** Draft

## Problem

Two user-visible defects in the current macOS release pipeline:

1. **Intel Mac crash on launch.** Users installing `CookEd-x64.dmg` from `v0.1.0-alpha.0` see Gatekeeper block first, then after stripping quarantine with `xattr -cr` the app crashes immediately with a dyld error:
   > `Library not loaded: @rpath/Electron Framework.framework/Electron Framework`
2. **Unsigned, un-notarized builds.** Gatekeeper blocks launch on every clean machine; users must manually strip quarantine. The release is not distributable publicly in this state.

## Root Cause

### Crash (Fix 1)

Comparing the `.app` bundle inside `CookEd-x64.dmg` against the `.app` bundle inside `CookEd-0.1.0-alpha.0-mac.zip` (same release, same build) produces a single-file diff: the 190 MB `Electron Framework.framework/Versions/A/Electron Framework` binary is missing from the DMG. Everything else — all 4758 other files, all symlinks — is identical.

The dropped file is the largest Mach-O in the bundle. This is consistent with the documented `hdiutil` behavior when an auto-sized DMG overflows: files can be silently dropped when the computed disk image size is too small for the payload.

The payload is oversized because `packages/cooklang-native/target/` (Cargo's incremental build cache, ~1.3 GB of `.rlib` / `.rmeta` intermediates) is shipping inside the bundle. Only the 11 MB compiled `.node` addon is a runtime artifact.

Two `electron-builder.yml` rules combine to let this happen:

- `asarUnpack: ["**/*.node", "**/cooklang-native/**"]` — the second glob un-packs every file in `cooklang-native/`, not just the `.node` binary.
- No negative `files:` glob excludes `target/` from the Cargo workspace source that lerna symlinks into `node_modules/@theia/cooklang-native/` at build time.

Net effect: `app.asar` = 425 MB (reasonable), `app.asar.unpacked` = 1.3 GB (of which 1.29 GB is Rust build cache).

### Notarization (Fix 3)

The crash report shows `"codeSigningID":""` and `"codeSigningTeamID":""`. `electron-builder.yml` has `hardenedRuntime: true` set but no signing identity, no `notarize:` configuration, and no Apple credentials in the release workflow. The app is literally unsigned.

## Scope

This spec covers:

- **Fix 1 — bundle hygiene** (crash blocker).
- **Fix 3 — signing and notarization** (distribution blocker).
- **Fix 2 — explicit DMG size** as a documented contingency, implemented only if Fix 1 alone does not restore the Framework binary.

Not in scope:
- Universal (x64+arm64) builds.
- Auto-update / differential updates beyond what electron-builder already emits.
- Windows signing.

## Fix 1 — Bundle Hygiene

**Change:** narrow `asarUnpack` and add negative `files:` globs in `examples/electron/electron-builder.yml` so Cargo intermediates cannot ship.

```yaml
asar: true
asarUnpack:
  - "**/*.node"
  # (drop the broad **/cooklang-native/** rule)

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

Rationale:
- `**/*.node` in `asarUnpack` already covers the native addon. No need for the broader `cooklang-native/**` glob.
- Negative `files:` globs defend against future shape changes in the workspace (e.g., if someone adds more dev artifacts to the package).
- `Cargo.*` covers `Cargo.toml` and `Cargo.lock` — both useless at runtime.
- `src/**` excludes Rust source (not needed by consumers of the `.node`).

**Expected bundle impact:**
- `app.asar.unpacked`: 1.3 GB → ~11 MB
- Total `.app`: ~2.0 GB → ~700 MB
- DMG: ~638 MB → ~350 MB (estimate based on 50–55% zlib ratio)

**How this resolves the crash:** with a right-sized payload, `hdiutil`'s auto-sized DMG has enough headroom to include all files, and the 190 MB Framework binary is no longer silently dropped.

## Fix 2 — Explicit DMG Size (contingency only)

If Fix 1 alone does not restore the Framework binary in the DMG, add an explicit size override:

```yaml
dmg:
  sign: false   # becomes `true` after Fix 3
  artifactName: ${productName}-${arch}.${ext}
  # Contingency: force DMG size if auto-sizing is unreliable
  # additionalSize: 200    # MB of headroom on top of content size
```

We do not ship this unless verification against a real Intel Mac (or at least a mounted DMG file-list diff against the zip) shows the file is still missing. Writing this down so a future debugger doesn't have to re-derive it.

## Fix 3 — Signing and Notarization

### Secrets

Five new GitHub Actions secrets on `cook-md/editor`:

| Secret | Value |
|--------|-------|
| `MAC_CSC_LINK` | Base64-encoded `.p12` of the Developer ID Application certificate (private key + cert). Generate via `base64 -i cert.p12 \| pbcopy`. |
| `MAC_CSC_KEY_PASSWORD` | Password for the `.p12`. |
| `APPLE_ID` | Apple ID email of the developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com (format `xxxx-xxxx-xxxx-xxxx`). |
| `APPLE_TEAM_ID` | 10-character team ID from developer.apple.com. |

### Workflow changes (`.github/workflows/release.yml`)

Add an `env:` block on the "Package & Publish" step for the macOS matrix entries:

```yaml
- name: Package & Publish
  working-directory: examples/electron
  shell: bash
  run: |
    PUBLISH="${{ (github.event_name == 'push' || github.event.inputs.publish == 'true') && 'always' || 'never' }}"
    if [ -n "${{ matrix.electron_arch }}" ]; then
      npx electron-builder --mac --${{ matrix.electron_arch }} --publish "$PUBLISH"
    else
      npx electron-builder --publish "$PUBLISH"
    fi
  env:
    GH_TOKEN: ${{ secrets.PUBLIC_REPO_PAT }}
    # Code signing (macOS only; safe to expose as empty on other matrix rows)
    CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
    # Notarization (electron-builder reads these directly)
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

### electron-builder.yml changes

```yaml
mac:
  icon: resources/icon.icns
  category: public.app-category.lifestyle
  darkModeSupport: true
  protocols:
    - name: cook
      schemes:
        - cook
  target:
    - dmg
    - zip
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  # New:
  notarize: true   # enables notarytool via APPLE_* env vars

dmg:
  sign: true       # was `false`; DMG must be signed once we have an identity
  artifactName: ${productName}-${arch}.${ext}
```

Notes:
- electron-builder 26.x reads `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` when `notarize: true` is set; no custom `afterSign` hook needed.
- `notarize: true` is the short form; explicit `notarize: { teamId: ... }` is supported but unnecessary when the env var is present.
- The existing `entitlements.mac.plist` (JIT, unsigned-exec memory, dyld env vars) is Electron-standard and works for notarization — no changes needed.

## Verification

For each fix, a specific, observable check. All of these run against the real released artifacts, not local-only tests.

### Fix 1 verification

1. Local: run `cd examples/electron && npm run bundle && npx electron-builder --mac --x64` on an arm64 dev machine (cross-compile locally as CI does).
2. Mount resulting `dist/CookEd-x64.dmg`. Run:
   ```
   find "/Volumes/CookEd .../CookEd.app" | wc -l
   file ".../Electron Framework.framework/Versions/A/Electron Framework"
   du -sh ".../CookEd.app"
   ```
3. **Pass criteria:**
   - `Electron Framework` binary exists and `file` reports Mach-O x86_64.
   - `.app` total size is < 1 GB (vs 2 GB previously).
   - No `cooklang-native/target/` under the `.app`.

### Fix 3 verification

1. After CI publishes, download the DMG and run:
   ```
   spctl --assess --type execute --verbose=4 /Applications/CookEd.app
   codesign --verify --deep --strict --verbose=4 /Applications/CookEd.app
   xcrun stapler validate /Applications/CookEd.app
   ```
2. **Pass criteria:**
   - `spctl`: `accepted` (not `rejected`).
   - `codesign`: `valid on disk`, `satisfies its Designated Requirement`.
   - `stapler`: `The validate action worked!` (ticket is stapled).
3. Install on the Intel Mac (no `xattr` dance required). Double-click from Finder → launches without Gatekeeper dialog.

## Rollout

1. Open a PR with Fix 1 (electron-builder.yml changes only).
2. User tests locally on Intel Mac with a locally-built DMG. Pass criteria from Fix 1 above.
3. If Fix 1 passes locally: merge and cut a new alpha tag (e.g. `v0.1.0-alpha.1`) with Fix 1 only. Verify in CI-produced artifact before proceeding.
4. If Fix 1 does not resolve the dropped-file issue, add Fix 2 to the PR.
5. User provisions the five GitHub Secrets listed above.
6. Open a follow-up PR with Fix 3 (workflow env block + `notarize: true` + `dmg.sign: true`).
7. Cut a second alpha tag. Verify signing + notarization via Fix 3 verification commands.
8. Only after both fixes land and verify, promote to a non-alpha release.

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Removing `**/cooklang-native/**` from `asarUnpack` accidentally asar-packs the `.node` binary | `**/*.node` remains in `asarUnpack` — covers the binary specifically. Verify in `app.asar.unpacked` post-build. |
| Cargo target dir also exists for future Rust packages added to the monorepo | The `!node_modules/**/@theia/cooklang-native/target/**` glob is package-specific. If we add more Rust packages later, we'll need to broaden to `!node_modules/**/@theia/*/target/**`. Accept as follow-up. |
| Notarization rejects the build on first submission | Common causes: missing hardenedRuntime (already set ✓), missing entitlements (present ✓), signing identity mismatch with Team ID. Debug via `xcrun notarytool log <submission-id> --keychain-profile ...`. |
| App-specific password expires or Apple ID 2FA breaks the flow | Document migration path to App Store Connect API keys as a follow-up; not blocking. |
| `CSC_LINK` env var is exposed to non-macOS matrix rows | Harmless — electron-builder ignores it on Windows/Linux jobs. Confirmed by electron-builder source. |

## Open Questions

None at spec-write time. If Fix 1 verification passes and Fix 3 runs into notarization-specific issues (entitlement mismatches, identity errors), we'll address in implementation.
