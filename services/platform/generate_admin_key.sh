#!/bin/bash
# ============================================================================
# Generate Admin Key for Convex Self-Hosted Backend
# ============================================================================
# This script generates an admin key for accessing the Convex dashboard.
#
# Usage:
#   docker compose exec platform ./generate_admin_key.sh
# ============================================================================

set -e

echo "🔑 Generating Convex Admin Key..."
echo ""

# Load centralized env normalization
source "$(dirname "$0")/env.sh"
env_normalize_common
# Require a valid hex secret for admin key generation
ensure_hex_instance_secret

echo "📋 Instance Name: $INSTANCE_NAME"
echo ""

# Generate the admin key using the generate_key binary
# The admin key is cryptographically derived from the instance name and secret
# This uses the same binary that the official Convex Docker image uses
ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")

echo "✅ Admin key generated successfully!"
echo ""

# Build URLs using SITE_URL (which includes protocol, domain, and port for localhost)
# SITE_URL is set by env.sh and includes the port for localhost
BASE_URL="${SITE_URL:-http://localhost:${PORT:-3000}}"

# Dashboard and API are accessed via proxy paths
DASHBOARD_URL="${BASE_URL}/convex-dashboard"
DEPLOYMENT_URL="${BASE_URL}/ws_api"

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

