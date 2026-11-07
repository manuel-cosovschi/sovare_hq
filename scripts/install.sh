#!/usr/bin/env bash
# One-command installer/updater for Sovare HQ on macOS.
#   curl -fsSL https://raw.githubusercontent.com/manuel-cosovschi/sovare_hq/claude/wonderful-johnson-ysh44e/scripts/install.sh | bash
# Downloads the latest release .dmg, verifies its checksum, installs /Applications/Sovare HQ.app
# and opens it. Your data (~/Library/Application Support/com.sovare.hq) is never touched.
set -euo pipefail

REPO="manuel-cosovschi/sovare_hq"
BASE="https://github.com/$REPO/releases/latest/download"
APP="/Applications/Sovare HQ.app"

[[ "$(uname)" == "Darwin" ]] || { echo "Sovare HQ se instala en macOS."; exit 1; }
MAJOR=$(sw_vers -productVersion | cut -d. -f1)
(( MAJOR >= 11 )) || { echo "Se necesita macOS 11 o superior."; exit 1; }

TMP=$(mktemp -d)
MNT="$TMP/mnt"
cleanup() { hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "→ Descargando Sovare HQ…"
curl -fL --progress-bar "$BASE/Sovare-HQ.dmg" -o "$TMP/Sovare-HQ.dmg"
if curl -fsSL "$BASE/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt"; then
  EXPECTED=$(awk '/Sovare-HQ.dmg/{print $1}' "$TMP/SHA256SUMS.txt")
  ACTUAL=$(shasum -a 256 "$TMP/Sovare-HQ.dmg" | awk '{print $1}')
  [[ -z "$EXPECTED" || "$EXPECTED" == "$ACTUAL" ]] || { echo "✗ El checksum no coincide; no se instaló nada."; exit 1; }
  echo "✓ Checksum verificado"
fi

mkdir -p "$MNT"
hdiutil attach "$TMP/Sovare-HQ.dmg" -nobrowse -readonly -quiet -mountpoint "$MNT"

if pgrep -xq "sovare-hq"; then
  echo "→ Cerrando la versión abierta…"
  osascript -e 'quit app "Sovare HQ"' >/dev/null 2>&1 || true
  sleep 2
fi

echo "→ Instalando en /Applications…"
if [[ -w /Applications ]]; then
  rm -rf "$APP" && ditto "$MNT/Sovare HQ.app" "$APP"
else
  sudo rm -rf "$APP" && sudo ditto "$MNT/Sovare HQ.app" "$APP"
fi
xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true

echo "✓ Sovare HQ instalada. Abriendo…"
open "$APP"
