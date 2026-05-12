#!/bin/bash
set -e

cd "$(dirname "$0")"

# Capture the project root so the Rust backend can use it as default working dir.
# This survives the `cargo run` CWD change (which would otherwise land in src-tauri/).
export CORTEX_LAUNCH_DIR="$(pwd)"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Launch the Tauri desktop window (starts Vite dev server on :4731 + Rust backend)
npm run tauri:dev
