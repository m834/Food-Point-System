#!/bin/bash
#
# Build the Windows .exe installer from a macOS (or Linux) machine.
#
#   npm run dist:win
#
# On Windows, plain `npm run dist` is the right command and this script is not
# needed. This exists because the office builds on a Mac.
#
# The one thing that makes cross-building hard is better-sqlite3: it is a native
# module, and the copy in node_modules is compiled for THIS machine. Packaging
# it as-is produces an installer that dies on launch with a module-version
# error — the #1 packaging failure the skill warns about.
#
# Compiling it for Windows from here would need MSVC, so instead we fetch the
# prebuilt binary that better-sqlite3 publishes for Electron's ABI on
# win32-x64, swap it in for the duration of the package step, and put the local
# one back afterwards. The trap means the dev machine is restored even if
# electron-builder fails halfway.
#
# WHY THIS BRANCH IS PINNED TO ELECTRON 22 / better-sqlite3 9.6.0
#
# This client's PC is stuck on Windows 8.1, and Electron dropped Windows
# 7/8/8.1 support at v23 (its Chromium requires Windows 10+) — a newer build
# fails on launch with "This app can't run on your PC" regardless of ia32 vs
# x64. Electron 22.3.27 is the last release that still runs there.
#
# better-sqlite3 is pinned to 9.6.0 to match: it's the newest version that
# still PUBLISHES a prebuild for Electron 22's ABI (110) on win32-ia32 — newer
# better-sqlite3 releases stop shipping prebuilds that far back, which would
# leave this script with nothing to download.
#
# Both are exact versions in package.json (no ^) on purpose — a routine
# `npm update` must not silently re-break this client's install. This pin is
# specific to THIS branch/client; do not carry it back to main, where clients
# are on current Windows and should get the current Electron.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Architecture. ia32 is the safe choice for an old shop PC: a 32-bit build runs
# on 32-bit AND 64-bit Windows, where an x64 build refuses to start on 32-bit
# with "This app can't run on your PC".
#
#   npm run dist:win                      -> simple, ia32
#   npm run dist:win -- x64               -> simple, x64
#   npm run dist:win:branded              -> branded, ia32
#   npm run dist:win:branded -- x64       -> branded, x64
#
# BRANDED vs SIMPLE is the product decision, not a code branch. A branded build
# wears the client's own nine colours and artwork, read from their database; a
# simple build ships the stock navy look and never reads them. Neither shows
# the Appearance editor — that is a separate switch, and off unless a build
# asks for it. Both flags are read only in src/lib/branding.ts.
ARCH="ia32"
BRANDED=0

for arg in "$@"; do
  case "$arg" in
    --branded) BRANDED=1 ;;
    ia32 | x64) ARCH="$arg" ;;
    *)
      echo "Unknown argument: $arg (expected ia32, x64 or --branded)" >&2
      exit 1
      ;;
  esac
done

NATIVE="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
CACHE=".build-cache/win-native-$ARCH"

BS3_VERSION="$(node -p "require('better-sqlite3/package.json').version")"
ELECTRON_VERSION="$(node -p "require('electron/package.json').version")"

# A prebuild is keyed to the ABI (module version), not to the Electron version,
# so derive it rather than hard-coding a number that silently goes stale the
# next time Electron is upgraded. node-abi ships with electron-builder.
ABI="$(node -p "require('node-abi').getAbi('${ELECTRON_VERSION}', 'electron')" 2>/dev/null || true)"

if [ -z "$ABI" ]; then
  echo "Could not work out Electron's ABI for ${ELECTRON_VERSION}." >&2
  echo "Check that electron and node-abi are installed." >&2
  exit 1
fi

TARBALL="better-sqlite3-v${BS3_VERSION}-electron-v${ABI}-win32-${ARCH}.tar.gz"
URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v${BS3_VERSION}/${TARBALL}"

echo "better-sqlite3 ${BS3_VERSION}, Electron ${ELECTRON_VERSION} (ABI ${ABI}), win32-${ARCH}"

if [ ! -f "$CACHE/build/Release/better_sqlite3.node" ]; then
  echo "Fetching the Windows prebuild..."
  mkdir -p "$CACHE"
  curl -fsSL --retry 3 -o "$CACHE/$TARBALL" "$URL" || {
    echo "" >&2
    echo "Could not download $TARBALL" >&2
    echo "No prebuild is published for this combination. Either pin an" >&2
    echo "Electron version that has one, or build the installer on Windows." >&2
    exit 1
  }
  tar xzf "$CACHE/$TARBALL" -C "$CACHE"
fi

# Verify what we fetched really is a Windows binary before trusting it.
if ! file "$CACHE/build/Release/better_sqlite3.node" | grep -q "for MS Windows"; then
  echo "The downloaded binary is not a Windows DLL. Refusing to package." >&2
  exit 1
fi

BACKUP="$(mktemp -t better_sqlite3)"
cp "$NATIVE" "$BACKUP"

restore() {
  cp "$BACKUP" "$NATIVE"
  rm -f "$BACKUP"
  echo "Restored this machine's native binary."
}
trap restore EXIT

cp "$CACHE/build/Release/better_sqlite3.node" "$NATIVE"

# The two installers must not overwrite each other in release/ — handing a shop
# the wrong one is a support call, and they are indistinguishable once the
# filename is gone.
if [ "$BRANDED" = "1" ]; then
  echo "Build: BRANDED (client can set their own colours and artwork)"
  export NEXT_PUBLIC_FOOD_BRANDING=1
  ARTIFACT='${productName}-Branded-Setup-${version}.exe'
else
  echo "Build: SIMPLE (stock look, no Appearance screen)"
  # Set explicitly rather than left unset: an absent variable compiles to a
  # runtime lookup that happens to be false, where "0" compiles to a literal
  # false and the Appearance branch is dropped outright.
  export NEXT_PUBLIC_FOOD_BRANDING=0
  ARTIFACT='${productName}-Setup-${version}.exe'
fi

npm run build
# npmRebuild off: electron-builder would otherwise try to rebuild native deps
# for win32 from macOS, which needs MSVC. The binary swapped in above is
# already the correct one.
npx electron-builder --win --"$ARCH" \
  --config.npmRebuild=false \
  --config.win.artifactName="$ARTIFACT"

echo ""
echo "Installer:"
ls -la release/*.exe
