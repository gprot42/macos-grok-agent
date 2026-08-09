#!/bin/bash
set -e

cd "$(dirname "$0")"

VERSION=$(grep '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: "//;s/".*//')
PRODUCT_NAME=$(grep '"productName"' src-tauri/tauri.conf.json | head -1 | sed 's/.*: "//;s/".*//')

DMG_DIR="src-tauri/target/release/bundle/dmg"
APP_BUNDLE_NAME="${PRODUCT_NAME}.app"
APP_PATH="src-tauri/target/release/bundle/macos/${APP_BUNDLE_NAME}"

# Tauri names the DMG from productName as-is (may contain spaces).
# We always normalize to underscores as the single canonical artifact name.
TAURI_DMG_NAME="${PRODUCT_NAME}_${VERSION}_aarch64.dmg"
DMG_NAME="${PRODUCT_NAME// /_}_${VERSION}_aarch64.dmg"
CANONICAL_DMG="$DMG_DIR/$DMG_NAME"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Building ${PRODUCT_NAME} v${VERSION}..."

# Clean old DMGs (both naming styles + temp rw.* files) so we don't leave duplicates
rm -f \
  "$DMG_DIR/$DMG_NAME" \
  "$DMG_DIR/$TAURI_DMG_NAME" \
  "$DMG_DIR"/rw.*.dmg \
  "./$DMG_NAME" \
  "./$TAURI_DMG_NAME" \
  2>/dev/null || true

# Run the Tauri build; ignore exit code because npm sometimes returns 0 even when
# Tauri's DMG bundler fails (e.g. AppleScript incompatibility on macOS 26+)
npm run tauri:build || true

# Prefer Tauri's output; normalize space-named DMG to the underscore canonical name
if [ -f "$CANONICAL_DMG" ]; then
  : # already canonical
elif [ -f "$DMG_DIR/$TAURI_DMG_NAME" ]; then
  echo "Normalizing DMG name: $TAURI_DMG_NAME → $DMG_NAME"
  mv "$DMG_DIR/$TAURI_DMG_NAME" "$CANONICAL_DMG"
elif [ -d "$APP_PATH" ]; then
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
    "$CANONICAL_DMG" \
    "$APP_PATH"
else
  echo "Error: .app bundle not found at $APP_PATH"
  exit 1
fi

# Drop any leftover non-canonical DMGs from this build
rm -f "$DMG_DIR"/rw.*.dmg 2>/dev/null || true
if [ "$TAURI_DMG_NAME" != "$DMG_NAME" ]; then
  rm -f "$DMG_DIR/$TAURI_DMG_NAME" 2>/dev/null || true
fi

if [ ! -f "$CANONICAL_DMG" ]; then
  echo "Build completed but no DMG found at $CANONICAL_DMG"
  exit 1
fi

echo ""
echo "DMG built successfully: $CANONICAL_DMG"
echo "Size: $(du -h "$CANONICAL_DMG" | cut -f1)"

# Copy single canonical DMG to project root
cp "$CANONICAL_DMG" "./$DMG_NAME"
echo "Copied to: $(pwd)/$DMG_NAME"

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
    gh release upload "$TAG" "./$DMG_NAME" --clobber
  else
    gh release create "$TAG" "./$DMG_NAME" \
      --title "${PRODUCT_NAME} $TAG" \
      --notes "${PRODUCT_NAME} $TAG release" \
      --latest
  fi

  echo ""
  echo "Release $TAG published with DMG:"
  gh release view "$TAG" --json assets --jq '.assets[].name'
fi
