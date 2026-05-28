/**
 * `tale migrate config-layout` orchestration. Pipes the migrate-config-layout
 * bash script into the currently-running convex container via stdin so the
 * operator can run migrate FIRST (before redeploying with the new image).
 *
 * Uses cp (not mv) so old paths remain readable until the operator runs
 * `tale migrate config-layout --cleanup-old` after verifying the new
 * deployment is healthy. This is the rollback-insurance step.
 *
 * Runbook (2-step + optional cleanup):
 *   1. tale migrate config-layout
 *      (copies providers/*.secrets.json to new org-first paths;
 *      old paths remain so the currently-running old code still works)
 *   2. tale deploy --override-all -y
 *      (recreates convex with new code + seeds non-default orgs from builtin)
 *   3. (optional, after verifying health) tale migrate config-layout --cleanup-old
 *      (sha-verifies new == old, then unlinks the olds)
 */

import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { exec } from '../docker/exec';
import { isContainerRunning } from '../docker/is-container-running';

interface MigrateConfigLayoutOptions {
  dryRun: boolean;
  cleanupOld: boolean;
}

/**
 * The migrate script is inlined here so it survives `bun build --compile`.
 *
 * Earlier this lived at `tools/cli/src/lib/migrate-config-layout/script.sh`
 * and was read at runtime via `readFile(fileURLToPath(import.meta.url) +
 * '../migrate-config-layout/script.sh')`. That works under `bun run` from
 * source but Bun's `--compile` does NOT bundle runtime `fs.readFile` reads
 * — only assets imported with `with { type: 'file' }` or explicitly listed
 * in `Bun.build({entrypoints: [...]})`. The compiled binary then ENOENTed
 * at `/$bunfs/migrate-config-layout/script.sh`, breaking the entire
 * upgrade runbook for any operator running a release binary.
 *
 * Embedding as a TS template literal is the canonical pattern used by
 * sibling `reseed-all-orgs.ts:58-71` — bundle-safe by construction. The
 * `scripts/check-bundle.ts` post-build assertion greps for the
 * `MIGRATE_PLAN` marker so this regression cannot silently recur.
 *
 * Bash uses `${VAR}` for parameter expansion which collides with TS
 * template-literal `${...}` interpolation. Every literal `${` in the
 * script must be escaped as `\${`.
 */
const MIGRATE_SCRIPT = `#!/bin/bash
# Migrate providers/*.secrets.json from old per-domain layout to new
# org-first layout. Idempotent. Uses cp (not mv) so old paths remain
# readable until the operator runs \`tale migrate config-layout --cleanup-old\`.
#
# Old → new mapping:
#   $DATA/providers/<name>.secrets.json
#     → $DATA/default/providers/<name>.secrets.json
#   $DATA/providers/<org>/<name>.secrets.json
#     → $DATA/<org>/providers/<name>.secrets.json
#
# Scope: providers/*.secrets.json ONLY. Non-secret config is reseeded by
# \`tale deploy --override-all\` against the builtin catalog; non-provider
# .history/ trails under old paths are intentionally abandoned (the user's
# "secrets only" runbook trade-off).
#
# Designed to run against the CURRENTLY-running convex container (old
# image, old code paths still active). cp leaves old paths in place so
# old code keeps reading providers correctly until the operator runs
# \`tale deploy --override-all -y\` to recreate convex with the new code.
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

# Defense in depth: \`set -u\` already aborts on unset $DATA, but \${VAR:?…}
# gives a clearer error message and won't be defeated by a future \`set
# +u\` somewhere downstream. Critical because some branches below build
# absolute paths from $DATA and rm them — a silent empty would operate
# from the container's filesystem root.
DATA="\${TALE_CONFIG_DIR:-/app/data}"
: "\${DATA:?DATA must be a non-empty absolute path}"
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
# rather than overwriting — protects a concurrent UI-side \`atomicWriteSecret\`
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
if [ "\${#conflicts[@]}" -gt 0 ]; then
  echo
  echo "Unresolved conflicts (require manual reconciliation):"
  for c in "\${conflicts[@]}"; do
    echo "  - $c"
  done
fi
[ "$errors" -eq 0 ] || exit 1
`;

export async function migrateConfigLayout(
  options: MigrateConfigLayoutOptions,
): Promise<void> {
  const { dryRun, cleanupOld } = options;

  const containerName = `${getProjectId()}-convex`;
  if (!(await isContainerRunning(containerName))) {
    // Earlier the message said "e.g. `tale deploy`", but `tale deploy`
    // now hard-fails on legacy layout — creating a deadlock for fresh
    // upgrades where the operator stopped the convex container before
    // running migrate. Point at `tale start` (which only fails when
    // legacy layout is present at the host) and the docs runbook.
    throw new Error(
      `Convex container "${containerName}" is not running. ` +
        'Start the OLD platform first (`tale start` or `docker compose start convex`) ' +
        'so the migrate script can run against the still-mounted volume, then re-run ' +
        '`tale migrate config-layout`. See docs/<locale>/self-hosted/operate/upgrades.md ' +
        'for the full migrate → deploy → cleanup runbook.',
    );
  }

  const scriptArgs: string[] = [];
  if (dryRun) scriptArgs.push('--dry-run');
  if (cleanupOld) scriptArgs.push('--cleanup-old');

  logger.blank();
  if (cleanupOld) {
    logger.step(
      dryRun
        ? '[DRY-RUN] Cleanup-old: would verify and remove old-path secrets'
        : 'Verifying + removing old-path secrets (byte-for-byte matched against new paths)...',
    );
  } else {
    logger.step(
      dryRun
        ? '[DRY-RUN] Migrate: would cp providers/*.secrets.json to new org-first paths'
        : 'Copying providers/*.secrets.json to new org-first paths (old paths preserved for rollback)...',
    );
  }

  // `docker exec -i ... bash -s -- <args>` runs the script piped via
  // stdin; the `--` separates script args from bash's own flags.
  const result = await exec(
    'docker',
    ['exec', '-i', containerName, 'bash', '-s', '--', ...scriptArgs],
    { stdin: MIGRATE_SCRIPT },
  );

  if (result.stdout) logger.info(result.stdout);
  if (!result.success) {
    if (result.stderr) logger.error(result.stderr.trim());
    throw new Error(
      `tale migrate config-layout${cleanupOld ? ' --cleanup-old' : ''} failed (exit code ${result.exitCode}).`,
    );
  }
  if (result.stderr) {
    // The script now sends only true `ERROR:` lines to stderr (SKIP
    // notices go to stdout). On a clean run we still see nothing here;
    // any non-empty stderr on success means the script encountered a
    // recoverable conflict (dst collision, invalid slug shape) that
    // didn't bump errors past zero — surface it loudly so the operator
    // notices.
    logger.warn(result.stderr.trim());
  }
}
