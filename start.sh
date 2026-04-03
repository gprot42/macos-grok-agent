#!/bin/bash
set -e

cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Start Tauri dev mode
npm run tauri:dev
