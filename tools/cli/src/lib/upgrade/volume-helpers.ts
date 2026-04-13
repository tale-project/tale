import * as logger from '../../utils/logger';
import { docker } from '../docker/docker';

/**
 * Sentinel file written inside a destination volume once the `cp -a` completes
 * successfully. Presence guarantees a complete migration; absence (with data
 * present) indicates a partial/interrupted copy that must be recovered.
 */
export const MIGRATION_SENTINEL = '.tale-migration-complete';

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

export async function volumeHasSentinel(
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

export async function volumeSizeBytes(
  name: string,
  image: string,
): Promise<number | null> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'du -sb /vol | cut -f1',
  );
  if (!r.success) return null;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export async function volumeFileCount(
  name: string,
  image: string,
): Promise<number | null> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'find /vol -type f | wc -l',
  );
  if (!r.success) return null;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** Rename a volume's contents aside by moving them into a timestamped sub-dir.
 *  Safer than deleting: if we later discover we wiped legitimate data, the
 *  operator can recover by hand. Note: docker volumes can't be renamed, so we
 *  create a sibling *-partial-<ts> volume and copy the unsentinelled contents
 *  into it before wiping the destination. */
export async function moveContentsToBackupVolume(
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
  const wipe = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    'find /vol -mindepth 1 -delete',
  );
  if (!wipe.success) {
    logger.warn(`  failed to wipe ${name}: ${wipe.stderr.trim()}`);
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

  // `--user 1001:1001` ensures destination files are owned by the `app` user
  // that tale containers run as (UID 1001).
  const copy = await docker(
    'run',
    '--rm',
    '--user',
    '1001:1001',
    '-v',
    `${src}:/src:ro`,
    '-v',
    `${dst}:/dst`,
    '--entrypoint',
    'sh',
    image,
    '-c',
    `cp -a /src/. /dst/ && : > /dst/${MIGRATION_SENTINEL}`,
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
  // Destination includes the sentinel file; src does not.
  const expectedDst = srcCount + 1;
  if (dstCount !== expectedDst) {
    throw new Error(
      `file count mismatch for ${src} → ${dst}: src=${srcCount}, dst=${dstCount} (expected ${expectedDst} = src + sentinel). Refusing to mark migration complete.`,
    );
  }
  logger.success(`  ${src} → ${dst} (${srcCount} files)`);
}
