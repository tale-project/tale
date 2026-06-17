#!/bin/bash
# ============================================================================
# Generate Admin Key for Convex Self-Hosted Backend
# ============================================================================
# Derives the Convex admin key from INSTANCE_NAME + INSTANCE_SECRET using the
# same `generate_key` binary the official Convex Docker image ships. The key is
# DETERMINISTIC: it is identical across restarts as long as INSTANCE_SECRET is
# unchanged (docker-entrypoint.sh re-derives the very same value on every boot).
#
# Usage:
#   docker compose exec platform ./generate-admin-key.sh             # human-readable block
#   docker compose exec platform ./generate-admin-key.sh --key-only  # just the key (scripts/CLI)
# ============================================================================

set -e

KEY_ONLY=false
case "${1:-}" in
  --key-only | --raw) KEY_ONLY=true ;;
esac

# Load centralized env normalization
source "$(dirname "$0")/env.sh"
env_normalize_common
# Require a valid hex secret for admin key generation
ensure_hex_instance_secret

# Generate the admin key using the generate_key binary.
# The admin key is cryptographically derived from the instance name and secret.
# This uses the same binary that the official Convex Docker image uses.
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")

# Machine-readable mode: emit only the key on stdout so callers (the `tale` CLI,
# get-admin-key.sh) can capture it without scraping decoration.
if [ "$KEY_ONLY" = true ]; then
  printf '%s\n' "$ADMIN_KEY"
  exit 0
fi

echo "🔑 Generating Convex Admin Key..."
echo ""
echo "📋 Instance Name: $INSTANCE_NAME"
echo ""
echo "✅ Admin key generated successfully!"
echo ""

# Build URLs using SITE_URL (which includes protocol, domain, and port for localhost)
# SITE_URL is set by env.sh and includes the port for localhost
BASE_URL="${SITE_URL:-http://localhost:${PORT:-3000}}"

# Dashboard and API are accessed via proxy paths
DASHBOARD_URL="${BASE_URL}/convex-dashboard"
# Deployment URL is the base URL without /ws_api suffix
# The dashboard proxy rewrites /api/ paths to /convex-dashboard-api/
DEPLOYMENT_URL="${BASE_URL}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 DASHBOARD ACCESS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   URL:            $DASHBOARD_URL"
echo "   Deployment URL: $DEPLOYMENT_URL"
echo "   Admin Key:      $ADMIN_KEY"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Steps:"
echo "   1. Open $DASHBOARD_URL in your browser"
echo "   2. Enter $DEPLOYMENT_URL as the Deployment URL"
echo "   3. Paste the admin key when prompted"
echo ""
