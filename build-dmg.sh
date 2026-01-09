#!/bin/bash
set -e

APP_NAME="Cortex Agent"
VERSION="0.0.1"
DMG_NAME="Cortex-Agent-${VERSION}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="dazdaz/app-cortex-agent"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --release    Create a GitHub release and upload the DMG"
    echo "  --help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0            Build DMG only"
    echo "  $0 --release  Build DMG and create GitHub release"
}

CREATE_RELEASE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --release)
            CREATE_RELEASE=true
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

echo "================================================"
echo "  Building ${APP_NAME} v${VERSION}"
echo "================================================"

cd "$SCRIPT_DIR"

echo ""
echo "[1/5] Checking dependencies..."
echo "------------------------------------------------"

if ! command -v cargo &> /dev/null; then
    echo "Error: Rust/Cargo not found. Install from https://rustup.rs"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Install from https://nodejs.org"
    exit 1
fi

if [ "$CREATE_RELEASE" = true ] && ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) not found. Install from https://cli.github.com"
    exit 1
fi

if command -v bun &> /dev/null; then
    PKG_MGR="bun"
elif command -v pnpm &> /dev/null; then
    PKG_MGR="pnpm"
else
    PKG_MGR="npm"
fi

echo "Using package manager: $PKG_MGR"
echo "Rust version: $(rustc --version)"
echo "Node version: $(node --version)"

echo ""
echo "[2/5] Installing frontend dependencies..."
echo "------------------------------------------------"
$PKG_MGR install

echo ""
echo "[3/5] Building frontend..."
echo "------------------------------------------------"
$PKG_MGR run build

echo ""
echo "[4/5] Building Tauri application..."
echo "------------------------------------------------"
cd src-tauri

if [ ! -f "icons/icon.icns" ]; then
    echo "Generating macOS icons..."
    mkdir -p icons
    
    python3 << 'PYEOF'
import os
from PIL import Image

icon_dir = 'icons'
os.makedirs(icon_dir, exist_ok=True)

sizes = [16, 32, 64, 128, 256, 512, 1024]
images = []

for size in sizes:
    img = Image.new('RGBA', (size, size), (99, 102, 241, 255))
    img.save(os.path.join(icon_dir, f'{size}x{size}.png'))
    images.append((size, img))

img_1024 = Image.new('RGBA', (1024, 1024), (99, 102, 241, 255))
img_1024.save(os.path.join(icon_dir, 'icon.png'))

print("PNG icons generated")
PYEOF

    if command -v iconutil &> /dev/null; then
        mkdir -p icons/icon.iconset
        for size in 16 32 64 128 256 512; do
            cp "icons/${size}x${size}.png" "icons/icon.iconset/icon_${size}x${size}.png"
            if [ -f "icons/$((size*2))x$((size*2)).png" ]; then
                cp "icons/$((size*2))x$((size*2)).png" "icons/icon.iconset/icon_${size}x${size}@2x.png"
            fi
        done
        iconutil -c icns icons/icon.iconset -o icons/icon.icns
        rm -rf icons/icon.iconset
        echo "Generated icon.icns"
    fi
fi

cargo tauri build --bundles dmg

cd "$SCRIPT_DIR"

echo ""
echo "[5/5] Locating DMG..."
echo "------------------------------------------------"

DMG_PATH=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)

if [ -n "$DMG_PATH" ]; then
    ARCH=$(uname -m)
    FINAL_DMG="${SCRIPT_DIR}/${DMG_NAME}-${ARCH}.dmg"
    cp "$DMG_PATH" "$FINAL_DMG"
    
    echo ""
    echo "================================================"
    echo "  Build Complete!"
    echo "================================================"
    echo ""
    echo "DMG Location: $FINAL_DMG"
    echo "Size: $(du -h "$FINAL_DMG" | cut -f1)"
    echo ""
    echo "The .dmg contains a self-contained .app bundle"
    echo "with all frameworks and libraries embedded."
    echo ""
    
    if [ "$CREATE_RELEASE" = true ]; then
        echo ""
        echo "[6/6] Creating GitHub Release..."
        echo "------------------------------------------------"
        
        TAG="v${VERSION}"
        RELEASE_TITLE="${APP_NAME} ${TAG}"
        RELEASE_NOTES="## ${APP_NAME} ${TAG}

### Downloads
- **macOS (${ARCH})**: ${DMG_NAME}-${ARCH}.dmg

### What's New
- Initial release of Cortex Agent
- Support for Claude 4, Gemini 2.5, and image generation
- Multiple prompt sessions with tabs
- Token tracking with cost estimation
- Project management for organizing outputs
- Three themes: Light, Tokyo Night, Dark

### Installation
1. Download the DMG file for your architecture
2. Open the DMG and drag Cortex Agent to Applications
3. Launch from Applications folder

Built with Tauri, React, and Rust. No external dependencies required."

        echo "Creating release ${TAG}..."
        
        if gh release view "$TAG" --repo "$REPO" &> /dev/null; then
            echo "Release ${TAG} already exists, uploading asset..."
            gh release upload "$TAG" "$FINAL_DMG" --repo "$REPO" --clobber
        else
            gh release create "$TAG" "$FINAL_DMG" \
                --repo "$REPO" \
                --title "$RELEASE_TITLE" \
                --notes "$RELEASE_NOTES"
        fi
        
        echo ""
        echo "GitHub Release created: https://github.com/${REPO}/releases/tag/${TAG}"
    else
        if command -v open &> /dev/null; then
            read -p "Open DMG? [y/N] " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                open "$FINAL_DMG"
            fi
        fi
    fi
else
    echo "Error: DMG not found in build output"
    echo "Check src-tauri/target/release/bundle/ for build artifacts"
    exit 1
fi
