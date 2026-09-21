#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PORT=3004
export PORT="${PORT:-$DEFAULT_PORT}"
echo "[ai-gateway] starting on :${PORT}"
exec bun server.js
