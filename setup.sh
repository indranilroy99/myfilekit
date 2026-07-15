#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

echo "MyFileKit setup"
echo "==============="
echo "Detected OS: $(uname -s)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  echo "Install Node.js 18+ from https://nodejs.org/, then run this setup again."
  echo "The TypeScript source app must be built by Vite and cannot be opened directly."
  exit 1
fi

node scripts/setup.js
