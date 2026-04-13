import * as logger from '../../utils/logger';
import { docker } from '../docker/docker';

/**
 * Sentinel file written inside a destination volume once the `cp -a` completes
 * successfully. Presence guarantees a complete migration; absence (with data
 * present) indicates a partial/interrupted copy that must be recovered.
 */
const MIGRATION_SENTINEL = '.tale-migration-complete';

export async function volumeExists(name: string): Promise<boolean> {
  const r = await docker('volume', 'inspect', name);
  return r.success;
}

export async function volumeHasData(
  name: string,
  image: string,
): Promise<boolean> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'ls -A /vol | head -1',
  );
  return r.success && r.stdout.trim().length > 0;
}

async function volumeHasSentinel(
  name: string,
  image: string,
): Promise<boolean> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    `test -f /vol/${MIGRATION_SENTINEL}`,
  );
  return r.success;
}

async function volumeFileCount(
  name: string,
  image: string,
): Promise<number | null> {
  // `cp -a` preserves regular files, directories, and symlinks but silently
  // skips sockets, FIFOs, and device nodes. To keep src/dst counts
  // comparable, only count things cp will actually copy: regular files and
  // symlinks. Exclude the migration sentinel itself so chained migrations
  // (whose source may already carry a sentinel from an earlier pipeline
  // step) compare cleanly — sentinel presence is verified separately via
  // volumeHasSentinel.
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    `find /vol \\( -type f -o -type l \\) ! -name '${MIGRATION_SENTINEL}' | wc -l`,
  );
  if (!r.success) return null;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** Diagnostic: list relative paths present in `/src` but not in `/dst`, plus
 *  any special (non-regular, non-symlink, non-dir) files in src that cp -a
 *  would have skipped. Best-effort — used only on verification failure. */
async function diffVolumes(
  src: string,
  dst: string,
  image: string,
): Promise<string> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${src}:/src:ro`,
    '-v',
    `${dst}:/dst:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    [
      '(cd /src && find . \\( -type f -o -type l \\) | sort) > /tmp/s',
      '(cd /dst && find . \\( -type f -o -type l \\) | sort) > /tmp/d',
      'echo "--- src counts ---"',
      'echo "regular files: $(find /src -type f | wc -l)"',
      'echo "symlinks:      $(find /src -type l | wc -l)"',
      'echo "dirs:          $(find /src -type d | wc -l)"',
      'echo "special:       $(find /src ! -type f ! -type l ! -type d | wc -l)"',
      'echo "sentinel:      $(ls -la /src/.tale-migration-complete 2>/dev/null || echo absent)"',
      'echo "--- dst counts ---"',
      'echo "regular files: $(find /dst -type f | wc -l)"',
      'echo "symlinks:      $(find /dst -type l | wc -l)"',
      'echo "dirs:          $(find /dst -type d | wc -l)"',
      'echo "special:       $(find /dst ! -type f ! -type l ! -type d | wc -l)"',
      'echo "sentinel:      $(ls -la /dst/.tale-migration-complete 2>/dev/null || echo absent)"',
      'echo "--- in src but not dst (first 20) ---"',
      'comm -23 /tmp/s /tmp/d | head -20',
      'echo "--- in dst but not src (first 20) ---"',
      'comm -13 /tmp/s /tmp/d | head -20',
    ].join(' && '),
  );
  if (!r.success) return `diff failed: ${r.stderr.trim()}`;
  return r.stdout.trim();
}

/** Rename a volume's contents aside by moving them into a timestamped sub-dir.
 *  Safer than deleting: if we later discover we wiped legitimate data, the
 *  operator can recover by hand. Note: docker volumes can't be renamed, so we
 *  create a sibling *-partial-<ts> volume and copy the unsentinelled contents
 *  into it before wiping the destination. */
async function moveContentsToBackupVolume(
  name: string,
  image: string,
): Promise<string | null> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${name}.partial-${ts}`;
  const created = await docker('volume', 'create', backup);
  if (!created.success) {
    logger.warn(
      `  failed to create backup volume ${backup}: ${created.stderr.trim()}`,
    );
    return null;
  }
  const copy = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/src:ro`,
    '-v',
    `${backup}:/dst`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'cp -a /src/. /dst/',
  );
  if (!copy.success) {
    logger.warn(
      `  failed to copy partial contents into ${backup}: ${copy.stderr.trim()}`,
    );
    return null;
  }
  // Fail-fast wipe: `find -delete` without `-e` continues past errors and can
  // leave the destination half-wiped; a subsequent copyVolumeWithVerify would
  // then see corrupted state. Use `sh -e` so any rm failure aborts loudly.
  const wipe = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol`,
    '--entrypoint',
    'sh',
    image,
    '-ec',
    'cd /vol && find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +',
  );
  if (!wipe.success) {
    logger.warn(
      `  failed to wipe ${name} (destination may be partial): ${wipe.stderr.trim()}`,
    );
    return null;
  }
  return backup;
}

/** Find an image that is already available locally for running throwaway
 *  copy containers, avoiding a network pull. Prefers images we know Tale
 *  itself ships so plain `docker image inspect` succeeds.  */
export async function resolveMigrationImage(): Promise<string> {
  const candidates = ['tale-platform', 'tale-proxy', 'alpine'];
  for (const candidate of candidates) {
    const exact = await docker('image', 'inspect', candidate);
    if (exact.success) return candidate;
    const lookup = await docker(
      'images',
      '--format',
      '{{.Repository}}:{{.Tag}}',
    );
    if (lookup.success) {
      const match = lookup.stdout
        .split('\n')
        .find((line) => line.includes(candidate) && !line.includes('<none>'));
      if (match) return match.trim();
    }
  }
  // Final fallback: alpine — may trigger a pull, but docker run handles that
  // transparently.
  return 'alpine';
}

/** Stop a container and wait for it to exit. Treats failure as fatal so
 *  callers never run a volume copy against a live container. */
export async function stopContainerOrThrow(name: string): Promise<void> {
  const stop = await docker('stop', '-t', '30', name);
  if (!stop.success) {
    throw new Error(
      `failed to stop container ${name}: ${stop.stderr.trim() || 'unknown error'}`,
    );
  }
  const waited = await docker('wait', name);
  if (!waited.success) {
    throw new Error(
      `container ${name} did not confirm shutdown: ${waited.stderr.trim() || 'unknown error'}`,
    );
  }
}

/**
 * Copy the contents of one volume into another, verify with a strict file
 * count check (src vs dst-minus-sentinel must match exactly), and mark the
 * destination with the sentinel file only on success.
 *
 * If the destination already has data but no sentinel, it is moved aside
 * into a timestamped backup volume rather than wiped, so the operator can
 * recover manually if the earlier state was actually legitimate.
 */
export async function copyVolumeWithVerify(
  src: string,
  dst: string,
  image: string,
): Promise<void> {
  if (!(await volumeExists(dst))) {
    const created = await docker('volume', 'create', dst);
    if (!created.success) {
      throw new Error(
        `failed to create destination volume ${dst}: ${created.stderr.trim()}`,
      );
    }
  } else if (await volumeHasData(dst, image)) {
    if (await volumeHasSentinel(dst, image)) {
      // Already migrated — caller should have detected this and skipped. We
      // treat this as a soft no-op rather than an error.
      logger.debug(
        `${dst} already has migration sentinel; skipping re-copy in copyVolumeWithVerify`,
      );
      return;
    }
    // Safety rail: by the time we reach here, the calling migration's
    // `detect`/`findPending` has already asserted this destination is NOT
    // in its end-state. But if a migration has a detection bug and asks us
    // to copy something SMALLER than what's already on the destination,
    // this is almost certainly either (a) a stale / unrelated source being
    // pulled in, or (b) a logic error in the migration. Either way, silent
    // clobbering is wrong — fail loudly and let the operator investigate.
    const srcCountPre = await volumeFileCount(src, image);
    const dstCountPre = await volumeFileCount(dst, image);
    if (srcCountPre != null && dstCountPre != null) {
      if (srcCountPre === 0 && dstCountPre > 0) {
        throw new Error(
          `refusing to overwrite ${dst} (${dstCountPre} files) with empty source ${src}. This looks like a migration detection bug — destination already populated but source is empty.`,
        );
      }
      if (dstCountPre > srcCountPre * 2) {
        throw new Error(
          `refusing to overwrite ${dst} (${dstCountPre} files) with much smaller source ${src} (${srcCountPre} files). A migration should not replace populated destination data with a substantially smaller source — this looks like a stale/unrelated source volume.`,
        );
      }
    }
    logger.warn(
      `  ⚠  ${dst} has data but no sentinel; moving partial contents to backup volume`,
    );
    const backup = await moveContentsToBackupVolume(dst, image);
    if (!backup) {
      throw new Error(
        `could not preserve partial contents of ${dst}; aborting migration`,
      );
    }
    logger.info(`  partial contents preserved at volume: ${backup}`);
  }

  // Run the copy as root (no --user flag). Destination volume is newly
  // created by docker with a root-owned / directory, so a non-root process
  // cannot write into it. `cp -a` preserves ownership from source, so files
  // populated by the convex container (uid 1001) stay uid 1001. We chown
  // the dst root + sentinel explicitly so the app user can read/write at
  // the top level when convex later mounts it.
  const copy = await docker(
    'run',
    '--rm',
    '-v',
    `${src}:/src:ro`,
    '-v',
    `${dst}:/dst`,
    '--entrypoint',
    'sh',
    image,
    '-ec',
    `cp -a /src/. /dst/ && : > /dst/${MIGRATION_SENTINEL} && chown 1001:1001 /dst /dst/${MIGRATION_SENTINEL}`,
  );
  if (!copy.success) {
    throw new Error(`copy ${src} → ${dst} failed: ${copy.stderr.trim()}`);
  }

  const srcCount = await volumeFileCount(src, image);
  const dstCount = await volumeFileCount(dst, image);
  if (srcCount == null || dstCount == null) {
    throw new Error(
      `could not verify file counts for ${src} → ${dst} (src=${srcCount}, dst=${dstCount})`,
    );
  }
  // Both counts exclude the sentinel itself (see volumeFileCount) so chained
  // migrations compare cleanly regardless of whether src already carries a
  // sentinel from an earlier pipeline step.
  if (dstCount !== srcCount) {
    const diff = await diffVolumes(src, dst, image);
    throw new Error(
      `file count mismatch for ${src} → ${dst}: src=${srcCount}, dst=${dstCount}. Refusing to mark migration complete.\n${diff}`,
    );
  }
  if (!(await volumeHasSentinel(dst, image))) {
    throw new Error(
      `migration sentinel missing on ${dst} after copy. Refusing to mark migration complete.`,
    );
  }
  logger.success(`  ${src} → ${dst} (${srcCount} files)`);
}
