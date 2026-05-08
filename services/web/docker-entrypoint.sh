#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PORT=3001
export PORT="${PORT:-$DEFAULT_PORT}"
echo "[web] starting on :${PORT}"
exec bun server.js
