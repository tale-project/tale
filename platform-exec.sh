#!/bin/bash
# Helper script to exec into the running platform container
# Works with both blue-green deployment and standard deployment
#
# Usage:
#   ./platform-exec.sh ./generate_admin_key.sh
#   ./platform-exec.sh bash
#   ./platform-exec.sh npx convex env

set -e

# Check for running platform containers in priority order
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^tale-platform-blue$'; then
  CONTAINER="tale-platform-blue"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^tale-platform-green$'; then
  CONTAINER="tale-platform-green"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^tale_platform'; then
  # Standard deployment (compose.yml without blue/green)
  CONTAINER=$(docker ps --format '{{.Names}}' | grep '^tale_platform' | head -1)
else
  echo "Error: No platform container is running" >&2
  echo "Start the platform with: docker compose up -d" >&2
  exit 1
fi

echo "Using container: $CONTAINER" >&2

if [ $# -eq 0 ]; then
  # No arguments, start interactive shell
  exec docker exec -it "$CONTAINER" bash
else
  # Execute the provided command
  exec docker exec -it "$CONTAINER" "$@"
fi
