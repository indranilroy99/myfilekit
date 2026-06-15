#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

echo "MyFileKit setup"
echo "==============="
echo "Detected OS: $(uname -s)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  echo "Install Node.js 18+ from https://nodejs.org/ to use npm run dev."
  echo "You can still open index.html directly, or run: python3 -m http.server 4173"
  exit 1
fi

node scripts/setup.js

