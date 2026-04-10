#!/bin/bash
# ============================================================================
# Reset Owner Credentials
# ============================================================================
# Resets the owner's email and/or password via an internal Convex mutation.
#
# Usage (called by CLI via docker exec):
#   docker exec -e RESET_EMAIL=new@example.com -e RESET_PASSWORD='NewP@ss1' \
#     tale-platform-blue ./reset-owner.sh
# ============================================================================

set -e

# Load centralized env normalization
source "$(dirname "$0")/env.sh"
env_normalize_common
ensure_hex_instance_secret

# Generate ephemeral admin key (never leaves the container)
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")

# Run the Bun script with admin key and Convex URL
ADMIN_KEY="$ADMIN_KEY" \
CONVEX_URL="http://localhost:${CONVEX_PORT:-3210}" \
RESET_EMAIL="${RESET_EMAIL:-}" \
RESET_PASSWORD="${RESET_PASSWORD:-}" \
bun ./reset-owner.ts
