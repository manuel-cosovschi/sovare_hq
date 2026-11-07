#!/usr/bin/env bash
# Copies the freshly built Sovare HQ.app into /Applications (keeps your data: it lives in
# ~/Library/Application Support/com.sovare.hq, not inside the .app).
set -euo pipefail
cd "$(dirname "$0")/.."
APP=$(ls -d src-tauri/target/*/release/bundle/macos/"Sovare HQ.app" src-tauri/target/release/bundle/macos/"Sovare HQ.app" 2>/dev/null | head -1 || true)
[[ -n "$APP" ]] || { echo "Build first: ./scripts/build-mac.sh"; exit 1; }
osascript -e 'quit app "Sovare HQ"' >/dev/null 2>&1 || true
rm -rf "/Applications/Sovare HQ.app"
cp -R "$APP" /Applications/
# Unsigned local build: remove the quarantine flag so Gatekeeper lets it open.
xattr -dr com.apple.quarantine "/Applications/Sovare HQ.app" 2>/dev/null || true
echo "Installed /Applications/Sovare HQ.app — open it from Launchpad, Spotlight or the Dock."
