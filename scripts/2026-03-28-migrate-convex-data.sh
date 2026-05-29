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

# Volume names default to the `tale` compose-project shape. Operators
# running `docker compose -p mycompany …` (common when multiple Tale
# stacks share a host) need to supply their actual volume names via
# `--old-volume` / `--new-volume`, or set COMPOSE_PROJECT_NAME — the
# previous hardcoded `tale_…` silently skipped the migration with a
# "old volume not found" message that looked like a clean no-op.
# Round-3 P2 R32-P2-d.
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-tale}"
OLD_VOLUME="${COMPOSE_PROJECT}_platform-convex-data"
NEW_VOLUME="${COMPOSE_PROJECT}_platform-data"

while [ $# -gt 0 ]; do
  case "$1" in
    --old-volume) OLD_VOLUME="$2"; shift 2 ;;
    --new-volume) NEW_VOLUME="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--old-volume <name>] [--new-volume <name>]"
      echo ""
      echo "Defaults to <COMPOSE_PROJECT_NAME or 'tale'>_platform-convex-data and"
      echo "<COMPOSE_PROJECT_NAME or 'tale'>_platform-data. Run \`docker volume ls\` to find"
      echo "your project's actual volume names."
      exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

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
  echo ""
  echo "Available volumes (use --new-volume <name> if yours has a different prefix):"
  docker volume ls --format '  - {{ .Name }}' | head -20
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
        # copied trees. The earlier `|| true` swallowed real I/O
        # failures (disk-full, EACCES, EIO) — the script would echo
        # "0 new items copied" and exit 0 while the migration was
        # silently incomplete. The empty-src guard above already
        # handles the "no files to copy" edge case, so `|| true` is
        # not needed for set -e correctness. Drop it and let real
        # cp failures abort.
        cp -rn "$src/"* "$dst/"
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
