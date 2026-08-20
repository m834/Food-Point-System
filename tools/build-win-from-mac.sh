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

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Architecture. ia32 is the safe choice for an old shop PC: a 32-bit build runs
# on 32-bit AND 64-bit Windows, where an x64 build refuses to start on 32-bit
# with "This app can't run on your PC".
#
#   npm run dist:win           -> ia32
#   npm run dist:win -- x64    -> x64
ARCH="${1:-ia32}"
if [ "$ARCH" != "ia32" ] && [ "$ARCH" != "x64" ]; then
  echo "Architecture must be ia32 or x64, got: $ARCH" >&2
  exit 1
fi

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

npm run build
# npmRebuild off: electron-builder would otherwise try to rebuild native deps
# for win32 from macOS, which needs MSVC. The binary swapped in above is
# already the correct one.
npx electron-builder --win --"$ARCH" --config.npmRebuild=false

echo ""
echo "Installer:"
ls -la release/*.exe
