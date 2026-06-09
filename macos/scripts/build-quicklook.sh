#!/usr/bin/env bash
# Builds CookQuickLook.appex (universal arm64+x86_64), optionally code-signed.
# Output: macos/QuickLookExtension/build/CookQuickLook.appex
set -euo pipefail

# Resolve paths BEFORE cd-ing (so $0-relative lookups don't break afterwards).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$SCRIPT_DIR/../QuickLookExtension"

# --- Acquire xcodegen (prefer PATH; else pinned prebuilt binary; brew is unreliable on older Xcode) ---
XCODEGEN_VERSION="2.43.0"
if command -v xcodegen >/dev/null 2>&1; then
  XCODEGEN="$(command -v xcodegen)"
else
  TOOLDIR="build/tools"
  XCODEGEN=$(find "$TOOLDIR/xcodegen" -type f -name xcodegen -perm -u+x 2>/dev/null | head -1 || true)
  if [[ -z "$XCODEGEN" || ! -x "$XCODEGEN" ]]; then
    echo "Downloading XcodeGen $XCODEGEN_VERSION (prebuilt)..."
    mkdir -p "$TOOLDIR"
    curl -fsSL -o "$TOOLDIR/xcodegen.zip" \
      "https://github.com/yonaskolb/XcodeGen/releases/download/${XCODEGEN_VERSION}/xcodegen.zip"
    rm -rf "$TOOLDIR/xcodegen"
    unzip -q -o "$TOOLDIR/xcodegen.zip" -d "$TOOLDIR/xcodegen"
    # The release zip nests the binary (e.g. xcodegen/bin/xcodegen); locate it.
    XCODEGEN=$(find "$TOOLDIR/xcodegen" -type f -name xcodegen -perm -u+x 2>/dev/null | head -1)
  fi
fi

if [[ -z "${XCODEGEN:-}" || ! -x "$XCODEGEN" ]]; then
  echo "error: could not locate an xcodegen binary" >&2
  exit 1
fi

"$XCODEGEN" generate

# Match the appex version to the host app's (PlugInKit/LaunchServices reject an
# extension whose CFBundleVersion differs from its containing app). Read it from
# app/package.json; fall back to 1/1.0 for standalone local builds.
APP_VERSION=$(node -p "require('$REPO_ROOT/app/package.json').version" 2>/dev/null || echo "1.0")
VERSION_ARGS=("MARKETING_VERSION=${APP_VERSION}" "CURRENT_PROJECT_VERSION=${APP_VERSION}")

DERIVED="build/DerivedData"
SIGN_ARGS=(CODE_SIGNING_ALLOWED=NO)
# In CI, QUICKLOOK_SIGN_IDENTITY (a "Developer ID Application" identity hash/name) is
# provided so xcodebuild signs the appex AND its embedded CooklangParserFFI.framework
# inside-out, with hardened runtime + a secure timestamp. electron-builder cannot sign a
# nested .appex itself, so the appex must arrive pre-signed (then left alone via
# `mac.signIgnore`). QUICKLOOK_KEYCHAIN, if set, points codesign at the keychain holding
# the identity. The appex is not sandboxed, so no entitlements are applied.
if [[ -n "${QUICKLOOK_SIGN_IDENTITY:-}" ]]; then
  CSFLAGS="--timestamp --options runtime"
  if [[ -n "${QUICKLOOK_KEYCHAIN:-}" ]]; then
    CSFLAGS="${CSFLAGS} --keychain ${QUICKLOOK_KEYCHAIN}"
  fi
  SIGN_ARGS=(
    CODE_SIGNING_ALLOWED=YES
    CODE_SIGN_STYLE=Manual
    "CODE_SIGN_IDENTITY=${QUICKLOOK_SIGN_IDENTITY}"
    "DEVELOPMENT_TEAM=${QUICKLOOK_TEAM_ID:-}"
    # Do NOT inject com.apple.security.get-task-allow — Xcode adds that debug
    # entitlement by default, and notarization rejects it ("The executable
    # requests the com.apple.security.get-task-allow entitlement"). This appex
    # needs no entitlements (not sandboxed), so suppress the base set entirely.
    CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO
    "OTHER_CODE_SIGN_FLAGS=${CSFLAGS}"
  )
fi

xcodebuild \
  -project CookQuickLook.xcodeproj \
  -scheme CookQuickLook \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -destination 'generic/platform=macOS' \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  "${VERSION_ARGS[@]}" \
  "${SIGN_ARGS[@]}" \
  build

SRC=$(find "$DERIVED/Build/Products/Release" -name 'CookQuickLook.appex' | head -1)
mkdir -p build
rm -rf build/CookQuickLook.appex
cp -R "$SRC" build/CookQuickLook.appex
echo "Built: $(pwd)/build/CookQuickLook.appex"
lipo -info "build/CookQuickLook.appex/Contents/MacOS/CookQuickLook" || true

# PluginKit refuses to register an app extension that lacks these standard bundle
# keys, so Quick Look would never invoke it. Fail the build if they're missing.
for _k in CFBundleIdentifier CFBundleExecutable CFBundlePackageType; do
  _v=$(/usr/libexec/PlistBuddy -c "Print :${_k}" "build/CookQuickLook.appex/Contents/Info.plist" 2>/dev/null || true)
  if [[ -z "${_v}" ]]; then
    echo "error: appex Info.plist is missing ${_k} — PluginKit will not register the extension" >&2
    exit 1
  fi
done

# When signed, fail fast if the appex (or its embedded framework) isn't validly signed —
# electron-builder will refuse to seal the outer app over an unsigned nested component.
if [[ -n "${QUICKLOOK_SIGN_IDENTITY:-}" ]]; then
  echo "Verifying appex signature (deep)..."
  codesign --verify --deep --strict --verbose=2 "build/CookQuickLook.appex"
  # Fail fast on the debug entitlement that notarization rejects, rather than
  # discovering it after a slow notarytool round-trip.
  if codesign -d --entitlements :- "build/CookQuickLook.appex/Contents/MacOS/CookQuickLook" 2>/dev/null | grep -q "get-task-allow"; then
    echo "error: appex executable still has com.apple.security.get-task-allow (would fail notarization)" >&2
    exit 1
  fi
  # PlugInKit silently refuses to register a NON-sandboxed Quick Look preview extension.
  # This is the entitlement whose absence cost alpha.16–20; fail loudly if it's gone.
  if ! codesign -d --entitlements :- "build/CookQuickLook.appex" 2>/dev/null | grep -q "com.apple.security.app-sandbox"; then
    echo "error: appex is not sandboxed (missing com.apple.security.app-sandbox) — PluginKit will not register it" >&2
    exit 1
  fi
  echo "Signature OK: sandboxed, no get-task-allow."
fi
