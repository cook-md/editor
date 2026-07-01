#!/usr/bin/env bash
# Builds CookQuickLook.appex (universal arm64+x86_64), optionally code-signed.
# Output: macos/QuickLookExtension/build/CookQuickLook.appex
set -euo pipefail

# Resolve paths BEFORE cd-ing (so $0-relative lookups don't break afterwards).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$SCRIPT_DIR/../QuickLookExtension"

# run_with_timeout SECONDS CMD... — run CMD with a hard, portable timeout (macOS
# ships no `timeout` binary) via a background watchdog. Used to bound git clone.
run_with_timeout() {
  local secs="$1"; shift
  "$@" &
  local cmd_pid=$!
  ( sleep "$secs"; kill -TERM "$cmd_pid" 2>/dev/null || true
    sleep 5; kill -KILL "$cmd_pid" 2>/dev/null || true ) &
  local watch_pid=$!
  local rc=0
  wait "$cmd_pid" 2>/dev/null || rc=$?
  kill -TERM "$watch_pid" 2>/dev/null || true
  wait "$watch_pid" 2>/dev/null || true
  return "$rc"
}

# --- Prepare cooklang-rs as a LOCAL SwiftPM package (dodges a flaky CI download) ---
# The GitHub release-asset download of CooklangParserFFI.xcframework intermittently
# produces a STALLED connection on CI runners. SwiftPM/xcodebuild have no download
# timeout, so `xcodebuild -resolvePackageDependencies` — and even `swift package
# resolve` — hang until the job dies (alpha.25/alpha.26; tuist/tuist#9967,
# actions/runner-images#13175). curl, by contrast, aborts a stalled connection
# (--max-time) and retries with a FRESH one, which reliably dodges the stall. So we
# fetch the xcframework ourselves, drop cooklang-rs's remote binaryTarget from a
# local clone, and consume it via USE_LOCAL_XCFRAMEWORK — no SwiftPM tool ever
# performs the hanging download. The version lives in project.yml (below) as the
# single source of truth; the checksum comes from cooklang-rs's own manifest.
CRS_VERSION=$(sed -nE 's/^[[:space:]]*#[[:space:]]*cooklang-rs-version:[[:space:]]*([0-9][0-9.]*).*/\1/p' project.yml | head -1)
if [[ -z "${CRS_VERSION:-}" ]]; then
  echo "error: could not read '# cooklang-rs-version:' from project.yml" >&2
  exit 1
fi
CRS_DIR="build/cooklang-rs"
XCF_DEST="$CRS_DIR/bindings/out/CooklangParserFFI.xcframework"
if [[ ! -d "$XCF_DEST" ]]; then
  echo "Preparing local cooklang-rs $CRS_VERSION ..."
  rm -rf "$CRS_DIR"
  # Source clone via git (reliable — uses git, not the flaky artifact CDN);
  # bounded + retried just in case.
  cloned=0
  for attempt in 1 2 3; do
    if run_with_timeout 120 git clone --depth 1 --branch "v$CRS_VERSION" \
         https://github.com/cooklang/cooklang-rs "$CRS_DIR"; then cloned=1; break; fi
    echo "warning: cooklang-rs clone attempt $attempt failed; retrying..." >&2
    rm -rf "$CRS_DIR"; sleep 5
  done
  [[ "$cloned" -eq 1 ]] || { echo "error: could not clone cooklang-rs" >&2; exit 1; }

  XCF_SHA=$(sed -nE 's/.*checksum:[[:space:]]*"([a-f0-9]{64})".*/\1/p' "$CRS_DIR/Package.swift" | head -1)
  [[ -n "$XCF_SHA" ]] || { echo "error: no xcframework checksum in cooklang-rs Package.swift" >&2; exit 1; }
  XCF_URL="https://github.com/cooklang/cooklang-rs/releases/download/v$CRS_VERSION/CooklangParserFFI.xcframework.zip"

  # SHORT per-attempt timeout + many retries: a stalled connection is aborted at
  # --max-time and a fresh retry dodges it (unlike SwiftPM's no-timeout single-shot).
  echo "Downloading $XCF_URL via curl (abort+retry)..."
  curl -fL --retry 20 --retry-all-errors --retry-delay 10 \
    --connect-timeout 20 --max-time 120 \
    -o "$CRS_DIR/xcf.zip" "$XCF_URL"

  GOT_SHA=$(shasum -a 256 "$CRS_DIR/xcf.zip" | awk '{print $1}')
  if [[ "$GOT_SHA" != "$XCF_SHA" ]]; then
    echo "error: xcframework checksum mismatch (got $GOT_SHA, want $XCF_SHA)" >&2
    exit 1
  fi
  mkdir -p "$CRS_DIR/bindings/out"
  unzip -q -o "$CRS_DIR/xcf.zip" -d "$CRS_DIR/bindings/out"
  rm -f "$CRS_DIR/xcf.zip"
  [[ -d "$XCF_DEST" ]] || { echo "error: xcframework missing at $XCF_DEST after unzip" >&2; exit 1; }

  # Drop the remote binaryTarget so SwiftPM never tries to download it; the local
  # CooklangParserFFI_local (added by the manifest when USE_LOCAL_XCFRAMEWORK is
  # set) is used instead. Fail loudly if the removal didn't take.
  perl -0777 -pi -e 's/\.binaryTarget\(\s*name:\s*"CooklangParserFFI",\s*url:.*?checksum:[^)]*\),/\/* remote binaryTarget removed for offline build *\//s' "$CRS_DIR/Package.swift"
  if grep -q 'CooklangParserFFI.xcframework.zip' "$CRS_DIR/Package.swift"; then
    echo "error: failed to remove remote binaryTarget from cooklang-rs Package.swift" >&2
    exit 1
  fi
else
  echo "Reusing cached local cooklang-rs at $CRS_DIR"
fi
# Tell cooklang-rs's Package.swift to use the local xcframework path. Must be set
# before both xcodegen (manifest eval) and xcodebuild.
export USE_LOCAL_XCFRAMEWORK=1

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
SPM_PACKAGES="build/SourcePackages"
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

# cooklang-rs is now a LOCAL package (prepared above), so xcodebuild's package
# resolution is fully offline — no binary-artifact download to stall on.
xcodebuild \
  -project CookQuickLook.xcodeproj \
  -scheme CookQuickLook \
  -configuration Release \
  -derivedDataPath "$DERIVED" \
  -clonedSourcePackagesDirPath "$SPM_PACKAGES" \
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
