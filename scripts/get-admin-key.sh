#!/bin/bash
# Generate an admin key from the running platform container.
# Works with both standard deployment and blue-green deployment.
#
# Usage:
#   ./scripts/get-admin-key.sh

set -e

# Detect the running platform container
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^tale-platform-blue$'; then
  CONTAINER="tale-platform-blue"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^tale-platform-green$'; then
  CONTAINER="tale-platform-green"
elif docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^tale[-_]platform'; then
  CONTAINER=$(docker ps --format '{{.Names}}' | grep -E '^tale[-_]platform' | head -1)
else
  echo "Error: No platform container is running" >&2
  echo "Start the platform with: docker compose up -d" >&2
  exit 1
fi

docker exec -it "$CONTAINER" ./generate_admin_key.sh "$@"

