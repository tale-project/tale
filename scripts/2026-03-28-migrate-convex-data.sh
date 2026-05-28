#!/bin/bash
# ============================================================================
# Migration: Convex data migration (2026-03-28)
# ============================================================================
# Copies Convex storage data from old volume to new volume.
#
# Background:
#   The platform volume was renamed from platform-convex-data to platform-data.
#   Old Convex storage files (modules, user uploads) need to be copied to the
#   new volume so the Convex backend can find them.
#
# Note:
#   A prior version of this script also called `convex run
#   migrations/rename_org_slug:renameOrgSlug` (Phase 2) — that migration was
#   removed in v1.0 along with the upgrade framework; the Phase 2 step is
#   no longer needed and would now fail with "function not found".
#
# Prerequisites:
#   - Docker must be running
#   - Platform container should be stopped before running
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
        # `cp -rn` is no-clobber, so re-runs are no-ops on already-
        # copied trees. Earlier this swallowed stderr unconditionally,
        # which hid disk-full / permission-denied as "0 new items".
        # `|| true` is kept only to tolerate the "no files to copy"
        # edge case (matched glob with no entries) without aborting
        # `set -e`; real I/O errors now surface on stderr.
        cp -rn "$src/"* "$dst/" || true
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

# Phase 2 (renameOrgSlug) removed in v1.0 — the underlying Convex migration
# function no longer exists in the platform codebase.

echo ""
echo "✅ Migration complete!"
