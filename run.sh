#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if command -v bun &> /dev/null; then
    PKG_MGR="bun"
elif command -v pnpm &> /dev/null; then
    PKG_MGR="pnpm"
else
    PKG_MGR="npm"
fi

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    $PKG_MGR install
fi

echo "Starting Cortex Agent..."
$PKG_MGR run tauri:dev
