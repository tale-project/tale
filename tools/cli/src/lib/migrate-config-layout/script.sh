#!/bin/bash
# Migrate providers/*.secrets.json from old per-domain layout to new
# org-first layout. Idempotent. Uses cp (not mv) so old paths remain
# readable until the operator runs `tale migrate config-layout --cleanup-old`.
#
# Old → new mapping:
#   $DATA/providers/<name>.secrets.json
#     → $DATA/default/providers/<name>.secrets.json
#   $DATA/providers/<org>/<name>.secrets.json
#     → $DATA/<org>/providers/<name>.secrets.json
#
# Scope: providers/*.secrets.json ONLY. Non-secret config is reseeded by
# `tale deploy --override-all` against the builtin catalog; non-provider
# .history/ trails under old paths are intentionally abandoned (the user's
# "secrets only" runbook trade-off).
#
# Designed to run against the CURRENTLY-running convex container (old
# image, old code paths still active). cp leaves old paths in place so
# old code keeps reading providers correctly until the operator runs
# `tale deploy --override-all -y` to recreate convex with the new code.
set -euo pipefail

DRY_RUN=0
CLEANUP_OLD=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --cleanup-old) CLEANUP_OLD=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Defense in depth: `set -u` already aborts on unset $DATA, but ${VAR:?…}
# gives a clearer error message and won't be defeated by a future `set
# +u` somewhere downstream. Critical because some branches below build
# absolute paths from $DATA and rm them — a silent empty would operate
# from the container's filesystem root.
DATA="${TALE_CONFIG_DIR:-/app/data}"
: "${DATA:?DATA must be a non-empty absolute path}"
APP_UID=1001
APP_GID=1001

planned=0
copied=0
skipped=0
removed=0
errors=0
conflicts=()

# Move a single .secrets.json from old to new path. cp -a preserves mode +
# ownership (encrypted secrets are 0600 owner:app). Idempotent: if the
# destination already exists, verify byte-for-byte equality (then skip)
# rather than overwriting — protects a concurrent UI-side `atomicWriteSecret`
# that landed at the new path between this script's check and its copy.
copy_secret() {
  local src="$1" dst="$2"
  local dst_dir; dst_dir="$(dirname "$dst")"
  if [ -e "$dst" ]; then
    if cmp -s "$src" "$dst" 2>/dev/null; then
      # SKIP belongs to stdout (informational, expected on re-run);
      # only true ERROR lines go to stderr so the CLI wrapper can
      # distinguish noise from real failures.
      skipped=$((skipped+1)); echo "SKIP (already migrated): $src"
      return 0
    else
      conflicts+=("$src != $dst")
      errors=$((errors+1))
      echo "ERROR: $dst exists but differs from $src; refusing to overwrite" >&2
      return 0
    fi
  fi
  if [ "$DRY_RUN" = 1 ]; then
    echo "MIGRATE_PLAN: mkdir -p $dst_dir && cp -a $src $dst"
    planned=$((planned+1))
    return 0
  fi
  mkdir -p "$dst_dir"
  chown "$APP_UID:$APP_GID" "$dst_dir" 2>/dev/null || true
  cp -a "$src" "$dst"
  copied=$((copied+1))
  echo "OK: $src -> $dst"
}

# Remove an old-path secret IF the new-path copy exists and matches
# byte-for-byte. Refuses any mismatch — operator must reconcile manually.
remove_old_secret() {
  local old="$1" new="$2"
  if [ ! -e "$old" ]; then return 0; fi
  if [ ! -e "$new" ]; then
    conflicts+=("missing new-path counterpart for $old (expected $new)")
    errors=$((errors+1))
    echo "ERROR: $new does not exist; refusing to remove $old" >&2
    return 0
  fi
  if ! cmp -s "$old" "$new" 2>/dev/null; then
    conflicts+=("$old != $new")
    errors=$((errors+1))
    echo "ERROR: $old and $new differ; refusing to remove $old" >&2
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then
    echo "CLEANUP_PLAN: rm $old"
    planned=$((planned+1))
    return 0
  fi
  rm -f "$old"
  removed=$((removed+1))
  echo "REMOVED: $old"
}

# ---------------------------------------------------------------------------
# Enumeration
# ---------------------------------------------------------------------------

# Pre-scan: flag when both the flat path (providers/foo.secrets.json)
# and the nested path (providers/default/foo.secrets.json) would map to
# the same destination. Without this, copy_secret's per-pair cmp -s
# would surface only one of the two as an error, leaving the operator
# guessing which source was the "real" one.
detect_default_dst_collisions() {
  [ -d "$DATA/providers/default" ] || return 0
  for f in "$DATA"/providers/*.secrets.json; do
    [ -f "$f" ] || continue
    local base nested
    base="$(basename "$f")"
    nested="$DATA/providers/default/$base"
    if [ -f "$nested" ]; then
      conflicts+=("dst collision: $f and $nested both map to $DATA/default/providers/$base")
      errors=$((errors+1))
      echo "ERROR: $f and $nested both target $DATA/default/providers/$base; manual reconcile required" >&2
    fi
  done
}

process_secret() {
  local src="$1" dst="$2"
  if [ "$CLEANUP_OLD" = 1 ]; then
    remove_old_secret "$src" "$dst"
  else
    copy_secret "$src" "$dst"
  fi
}

detect_default_dst_collisions

# Default org: top-level $DATA/providers/*.secrets.json → $DATA/default/providers/
if [ -d "$DATA/providers" ]; then
  for f in "$DATA"/providers/*.secrets.json; do
    [ -f "$f" ] || continue
    process_secret "$f" "$DATA/default/providers/$(basename "$f")"
  done
fi

# Non-default orgs: $DATA/providers/<org>/*.secrets.json → $DATA/<org>/providers/
if [ -d "$DATA/providers" ]; then
  for d in "$DATA"/providers/*/; do
    [ -d "$d" ] || continue
    org="$(basename "$d")"
    case "$org" in
      .*) continue ;;
    esac
    # Validate against ORG_SLUG_REGEX (keep in sync with
    # services/platform/lib/shared/constants/org-slug.ts). No length
    # cap here — the canonical validator imposes none, and silently
    # dropping long-but-valid slugs would lose their secrets on
    # --cleanup-old. Anything that fails the shape is recorded as an
    # error + conflict so the summary surfaces it (legacy slugs from a
    # prior, more-permissive regime get an actionable diagnostic
    # rather than disappearing).
    if ! [[ "$org" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
      conflicts+=("invalid org slug under providers/: $org")
      errors=$((errors+1))
      echo "ERROR: providers/$org/ has invalid slug shape; manual reconcile required" >&2
      continue
    fi
    for f in "$d"*.secrets.json; do
      [ -f "$f" ] || continue
      process_secret "$f" "$DATA/$org/providers/$(basename "$f")"
    done
  done
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
if [ "$CLEANUP_OLD" = 1 ]; then
  if [ "$DRY_RUN" = 1 ]; then
    echo "MIGRATE_SUMMARY: planned=$planned removed=0 errors=$errors (cleanup-old --dry-run)"
  else
    echo "MIGRATE_SUMMARY: removed=$removed errors=$errors (cleanup-old)"
  fi
else
  if [ "$DRY_RUN" = 1 ]; then
    echo "MIGRATE_SUMMARY: planned=$planned copied=0 skipped=$skipped errors=$errors (--dry-run)"
  else
    echo "MIGRATE_SUMMARY: copied=$copied skipped=$skipped errors=$errors"
  fi
  if [ "$copied" -gt 0 ] || [ "$planned" -gt 0 ]; then
    echo "Next: run 'tale deploy --override-all -y' to recreate convex with the new code and seed non-default orgs."
  fi
fi
if [ "${#conflicts[@]}" -gt 0 ]; then
  echo
  echo "Unresolved conflicts (require manual reconciliation):"
  for c in "${conflicts[@]}"; do
    echo "  - $c"
  done
fi
[ "$errors" -eq 0 ] || exit 1
