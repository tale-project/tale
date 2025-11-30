#!/bin/bash
# Small helper to print the Convex admin key from the running platform container.
# This is just a thin wrapper around the platform's generate_admin_key.sh script.
#
# Usage (from repo root):
#   docker compose exec platform ./generate_admin_key.sh
# or equivalently:
#   ./scripts/get-admin-key.sh

set -e

# Forward all arguments to the script inside the container, in case we add flags later.
docker compose exec platform ./generate_admin_key.sh "$@"

