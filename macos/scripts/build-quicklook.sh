#!/usr/bin/env bash
# Builds CookQuickLook.appex (universal arm64+x86_64), optionally code-signed.
# Output: macos/QuickLookExtension/build/CookQuickLook.appex
set -euo pipefail

cd "$(dirname "$0")/../QuickLookExtension"

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

DERIVED="build/DerivedData"
SIGN_ARGS=(CODE_SIGNING_ALLOWED=NO)
# In CI, QUICKLOOK_SIGN_IDENTITY (a "Developer ID Application: ..." identity) is provided
# so the appex is signed with hardened runtime + its sandbox entitlements.
if [[ -n "${QUICKLOOK_SIGN_IDENTITY:-}" ]]; then
  SIGN_ARGS=(
    CODE_SIGNING_ALLOWED=YES
    CODE_SIGN_STYLE=Manual
    "CODE_SIGN_IDENTITY=${QUICKLOOK_SIGN_IDENTITY}"
    "DEVELOPMENT_TEAM=${QUICKLOOK_TEAM_ID:-}"
    OTHER_CODE_SIGN_FLAGS=--timestamp
  )
fi

xcodebuild \
  -project CookQuickLook.xcodeproj \
  -scheme CookQuickLook \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -destination 'generic/platform=macOS' \
  ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  "${SIGN_ARGS[@]}" \
  build

SRC=$(find "$DERIVED/Build/Products/Release" -name 'CookQuickLook.appex' | head -1)
mkdir -p build
rm -rf build/CookQuickLook.appex
cp -R "$SRC" build/CookQuickLook.appex
echo "Built: $(pwd)/build/CookQuickLook.appex"
lipo -info "build/CookQuickLook.appex/Contents/MacOS/CookQuickLook" || true
