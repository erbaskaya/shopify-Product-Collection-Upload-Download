#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS DMG must be built on macOS." >&2
  exit 1
fi

for command in node npm cargo rustc rustup; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "$command is not installed or is not in PATH." >&2
    exit 1
  fi
done

echo "Installing locked frontend dependencies..."
npm ci

echo "Validating the frontend..."
npm run build

echo "Installing Rust targets for a universal macOS build..."
rustup target add aarch64-apple-darwin x86_64-apple-darwin

echo "Building the universal macOS application and DMG..."
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg

DESTINATION="$PROJECT_ROOT/installers/macos"
mkdir -p "$DESTINATION"
BUNDLE_ROOT="$PROJECT_ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
find "$BUNDLE_ROOT" -type f -name '*.dmg' -exec cp -f {} "$DESTINATION/" \;

APP_PATH="$(find "$BUNDLE_ROOT" -maxdepth 3 -type d -name '*.app' -print -quit || true)"
if [[ -n "$APP_PATH" ]]; then
  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$DESTINATION/Shopify-Product-Collection-Upload-1.0.1-universal.app.zip"
fi

echo
echo "macOS installer build completed."
echo "Output: $DESTINATION"
ls -lh "$DESTINATION"
