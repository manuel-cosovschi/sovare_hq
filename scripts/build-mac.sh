#!/usr/bin/env bash
# Builds Sovare HQ.app and a .dmg on macOS (Apple Silicon or Intel).
# Requirements: macOS 11+, Xcode Command Line Tools, Node 20+, Rust (rustup).
# Usage: ./scripts/build-mac.sh [--universal]
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script must run on macOS (a .app/.dmg cannot be produced on Linux/Windows)." >&2
  exit 1
fi
command -v node >/dev/null || { echo "Install Node.js 20+ (https://nodejs.org)"; exit 1; }
command -v cargo >/dev/null || { echo "Install Rust: curl https://sh.rustup.rs -sSf | sh"; exit 1; }
xcode-select -p >/dev/null 2>&1 || { echo "Install Xcode Command Line Tools: xcode-select --install"; exit 1; }

npm ci
npm run check            # typecheck + lint + unit tests
(cd src-tauri && cargo test)

if [[ "${1:-}" == "--universal" ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  npx tauri build --target universal-apple-darwin
  OUT=src-tauri/target/universal-apple-darwin/release/bundle
else
  npx tauri build
  OUT=src-tauri/target/release/bundle
fi

echo
echo "Built:"
ls -1 "$OUT"/macos/*.app "$OUT"/dmg/*.dmg 2>/dev/null || true
echo
echo "Install: open the .dmg and drag 'Sovare HQ' to Applications, or run ./scripts/install-mac.sh"
