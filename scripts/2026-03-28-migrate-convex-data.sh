#!/bin/bash
# ============================================================================
# Migration: Convex data migration (2026-03-28)
# ============================================================================
# Handles two tasks:
#   1. Copy Convex storage data from old volume to new volume
#   2. Rename organization slug to "default"
#
# Background:
#   The platform volume was renamed from platform-convex-data to platform-data.
#   Old Convex storage files (modules, user uploads) need to be copied to the
#   new volume so the Convex backend can find them.
#
# Prerequisites:
#   - Docker must be running
#   - Platform container should be stopped for phase 1
#
# Usage:
#   ./scripts/2026-03-28-migrate-convex-data.sh
# ============================================================================
set -euo pipefail

OLD_VOLUME="tale_platform-convex-data"
NEW_VOLUME="tale_platform-data"
DIRS_TO_MIGRATE="modules files exports snapshot_imports"

echo "📦 Convex data migration (2026-03-28)"
echo ""

# ============================================================================
# Phase 1: Copy storage data from old volume to new volume
# ============================================================================

echo "── Phase 1: Volume data migration ──"

# Check that both volumes exist
old_exists=true
if ! docker volume inspect "$OLD_VOLUME" > /dev/null 2>&1; then
  old_exists=false
fi

if ! docker volume inspect "$NEW_VOLUME" > /dev/null 2>&1; then
  echo "❌ New volume '$NEW_VOLUME' not found. Run 'docker compose up -d' first to create it."
  exit 1
fi

if [ "$old_exists" = true ]; then
  echo "   Source: $OLD_VOLUME"
  echo "   Target: $NEW_VOLUME (under convex/)"
  echo ""

  docker run --rm \
    -v "${OLD_VOLUME}:/old:ro" \
    -v "${NEW_VOLUME}:/new" \
    alpine sh -c '
      set -e
      mkdir -p /new/convex

      for dir in '"$DIRS_TO_MIGRATE"'; do
        src="/old/$dir"
        dst="/new/convex/$dir"

        if [ ! -d "$src" ] || [ -z "$(ls -A "$src" 2>/dev/null)" ]; then
          echo "   ⏭  $dir/ (empty or missing, skipping)"
          continue
        fi

        mkdir -p "$dst"

        before=$(ls "$dst" 2>/dev/null | wc -l)
        cp -rn "$src/"* "$dst/" 2>/dev/null || true
        after=$(ls "$dst" | wc -l)
        added=$((after - before))

        echo "   ✓  $dir/ — $added new items copied (total: $after)"
      done
    '

  echo ""
  echo "✅ Phase 1 complete."
else
  echo "   ⏭  Old volume '$OLD_VOLUME' not found, skipping file migration."
  echo ""
fi

# ============================================================================
# Phase 2: Rename organization slug to "default"
# ============================================================================

find_platform_container() {
  docker ps --filter "name=tale-platform" --filter "status=running" --format '{{.Names}}' | head -1
}

echo ""
echo "── Phase 2: Organization slug rename ──"
echo ""

container=$(find_platform_container)

if [ -z "$container" ]; then
  echo "❌ Platform container is not running."
  echo "   Please start it first:"
  echo ""
  echo "     docker compose up --build -d platform"
  echo ""
  echo "   Then re-run this script."
  exit 1
fi

status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "unknown")
if [ "$status" != "healthy" ]; then
  echo "❌ Platform container '$container' is not healthy (status: $status)."
  echo "   Wait for it to become healthy, then re-run this script."
  exit 1
fi

echo "   ✅ $container is healthy."
echo "   Running organization slug migration..."

docker exec "$container" bash -c '
  source /app/env.sh
  env_normalize_common
  source /app/generate-admin-key.sh
  ensure_instance_secret
  ADMIN_KEY=$(generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
  cd /app
  HOME=/home/tanstack bunx convex run \
    migrations/rename_org_slug:renameOrgSlug \
    --url "http://localhost:3210" \
    --admin-key "$ADMIN_KEY" \
    --no-push 2>&1
' | grep -v "^Admin key\|^📋\|^✅ Admin\|^━\|^🌐\|^$\|Steps:\|Open\|Enter\|Paste"

echo ""
echo "✅ Migration complete!"
echo ""
echo "You can verify the organization slug with:"
echo "  docker exec $container bash -c 'source /app/env.sh && env_normalize_common && source /app/generate-admin-key.sh && ensure_instance_secret && ADMIN_KEY=\$(generate_key \"\$INSTANCE_NAME\" \"\$INSTANCE_SECRET\") && cd /app && HOME=/home/tanstack bunx convex data --component betterAuth organization --url \"http://localhost:3210\" --admin-key \"\$ADMIN_KEY\"'"
