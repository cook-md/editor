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
elif ! file "$FRAMEWORK_BIN" | grep -q "Mach-O"; then
    echo "FAIL: Framework is not Mach-O" >&2
    fail=1
else
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

NODE_ADDON=$(find "$APP/Contents/Resources/app.asar.unpacked/node_modules/@theia/cooklang-native" -name "*.node" -print -quit 2>/dev/null)
if [ -z "$NODE_ADDON" ] || [ ! -f "$NODE_ADDON" ]; then
    echo "FAIL: cooklang-native .node addon not found in bundle" >&2
    fail=1
else
    echo "OK: cooklang-native .node addon present ($(basename "$NODE_ADDON"))"
fi

APP_SIZE_MB=$(du -sm "$APP" | cut -f1)
# Threshold calibrated post-Fix 1 (2026-04-17): measured legitimate size
# is ~1030 MB (578 MB asar + 182 MB VS Code plugins + 261 MB Electron
# Framework). 1200 MB leaves headroom for growth while still catching a
# Cargo cache regression (which would push it back above 2 GB).
if [ "$APP_SIZE_MB" -gt 1200 ]; then
    echo "FAIL: .app size is ${APP_SIZE_MB} MB — expected < 1200 MB after bundle cleanup" >&2
    fail=1
else
    echo "OK: .app size is ${APP_SIZE_MB} MB"
fi

if [ "$fail" -ne 0 ]; then
    exit 1
fi
echo "ALL CHECKS PASSED"
