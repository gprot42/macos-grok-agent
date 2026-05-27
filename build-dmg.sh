#!/bin/bash
set -e

cd "$(dirname "$0")"

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: "//;s/".*//')
PRODUCT_NAME=$(grep '"productName"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: "//;s/".*//')

DMG_DIR="src-tauri/target/release/bundle/dmg"
APP_BUNDLE_NAME="${PRODUCT_NAME}.app"
APP_PATH="src-tauri/target/release/bundle/macos/${APP_BUNDLE_NAME}"
DMG_NAME="${PRODUCT_NAME// /_}_${VERSION}_aarch64.dmg"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Building ${PRODUCT_NAME} v${VERSION}..."

# Clean old DMGs before build so we can detect success reliably
rm -f "$DMG_DIR/$DMG_NAME" "$DMG_DIR"/rw.*.dmg 2>/dev/null || true

# Run the Tauri build; ignore exit code because npm sometimes returns 0 even when
# Tauri's DMG bundler fails (e.g. AppleScript incompatibility on macOS 26+)
npm run tauri:build || true

# If the DMG wasn't produced but the .app exists, run the manual fallback
if [ ! -f "$DMG_DIR/$DMG_NAME" ]; then
  if [ ! -d "$APP_PATH" ]; then
    echo "Error: .app bundle not found at $APP_PATH"
    exit 1
  fi

  echo ""
  echo "Tauri DMG bundler failed — falling back to manual DMG creation..."

  rm -f "$DMG_DIR"/rw.*.dmg 2>/dev/null || true

  # Create DMG with --skip-jenkins to avoid Finder AppleScript errors on macOS 26+
  bash "$DMG_DIR/bundle_dmg.sh" \
    --volname "${PRODUCT_NAME}" \
    --no-internet-enable \
    --hide-extension "${APP_BUNDLE_NAME}" \
    --app-drop-link 480 170 \
    --icon "${APP_BUNDLE_NAME}" 180 170 \
    --skip-jenkins \
    "$DMG_DIR/$DMG_NAME" \
    "$APP_PATH"
fi

# Find the DMG
DMG=$(find src-tauri/target/release/bundle -name '*.dmg' ! -name 'rw.*' 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo "Build completed but no DMG found."
  exit 1
fi

echo ""
echo "DMG built successfully: $DMG"
echo "Size: $(du -h "$DMG" | cut -f1)"

# Copy DMG to home folder
cp "$DMG" ~/
HOME_DMG="$HOME/$(basename "$DMG")"
echo "Copied to: $HOME_DMG"

# Release mode: create GitHub release and upload DMG
if [ "$1" = "release" ]; then
  echo ""
  echo "Creating GitHub release v${VERSION}..."

  if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed. Install it with: brew install gh"
    exit 1
  fi

  TAG="v${VERSION}"

  if gh release view "$TAG" &> /dev/null; then
    echo "Release $TAG already exists — uploading DMG to it..."
    gh release upload "$TAG" "$DMG" --clobber
  else
    gh release create "$TAG" "$DMG" \
      --title "${PRODUCT_NAME} $TAG" \
      --notes "${PRODUCT_NAME} $TAG release" \
      --latest
  fi

  echo ""
  echo "Release $TAG published with DMG:"
  gh release view "$TAG" --json assets --jq '.assets[].name'
fi
