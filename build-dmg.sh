#!/bin/bash
set -e

cd "$(dirname "$0")"

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: "//;s/".*//')

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Building Cortex Agent v${VERSION}..."

# Build the app (Tauri DMG bundling may fail on macOS 26+ due to AppleScript issues)
if npm run tauri:build 2>&1; then
  echo ""
else
  echo ""
  echo "Tauri DMG bundler failed — falling back to manual DMG creation..."

  APP_PATH="src-tauri/target/release/bundle/macos/Cortex Agent.app"
  DMG_DIR="src-tauri/target/release/bundle/dmg"
  DMG_NAME="Cortex Agent_${VERSION}_aarch64.dmg"

  if [ ! -d "$APP_PATH" ]; then
    echo "Error: .app bundle not found at $APP_PATH"
    exit 1
  fi

  # Clean up old DMGs
  rm -f "$DMG_DIR/$DMG_NAME" "$DMG_DIR"/rw.*.dmg

  # Create DMG with --skip-jenkins to avoid Finder AppleScript errors on macOS 26+
  bash "$DMG_DIR/bundle_dmg.sh" \
    --volname "Cortex Agent" \
    --no-internet-enable \
    --hide-extension "Cortex Agent.app" \
    --app-drop-link 480 170 \
    --icon "Cortex Agent.app" 180 170 \
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

  # Create the release (or use existing one)
  if gh release view "$TAG" &> /dev/null; then
    echo "Release $TAG already exists — uploading DMG to it..."
    gh release upload "$TAG" "$DMG" --clobber
  else
    gh release create "$TAG" "$DMG" \
      --title "Cortex Agent $TAG" \
      --notes "Cortex Agent $TAG release" \
      --latest
  fi

  echo ""
  echo "Release $TAG published with DMG:"
  gh release view "$TAG" --json assets --jq '.assets[].name'
fi
