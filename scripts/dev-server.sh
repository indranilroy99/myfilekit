#!/bin/sh
# Start the dev server and the conversion server together.
#
# Exists because the preview launcher starts commands from the session's working
# directory, which is not necessarily this project — and Vite resolves react
# from the CWD, so it fails with "Failed to resolve dependency: react" when
# started from anywhere else. Cd'ing here first is the whole job.
set -e
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

# The API is same-origin in the browser (Vite proxies /api), so the converter has
# to be up for the server-side options to appear at all.
if ! curl -fsS -o /dev/null http://localhost:8081/api/health 2>/dev/null; then
  node server/index.js &
  trap 'kill $! 2>/dev/null' EXIT INT TERM
fi

exec npm run dev -- --port "${PORT:-4173}" --strictPort
