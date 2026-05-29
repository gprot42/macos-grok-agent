#!/bin/bash
set -e

cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Run the build
echo "Building project..."
npm run build

echo "Build completed successfully!"
