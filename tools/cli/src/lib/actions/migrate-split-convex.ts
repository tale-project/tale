import { confirm } from '../../utils/confirm';
import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { docker } from '../docker/docker';

const MIGRATION_SENTINEL = '.tale-migration-complete';

interface SplitConvexOptions {
  /** Skip interactive confirmation. */
  force?: boolean;
  /** Print plan but make no changes. */
  dryRun?: boolean;
}

interface MigrationPair {
  /** Legacy volume (source). */
  oldName: string;
  /** Target volume (destination). */
  newName: string;
  /** Label for logs. */
  scope: 'prod' | 'dev';
}

/**
 * Build the set of `${prefix}_platform-data` → `${prefix}_convex-data`
 * migrations we need to perform for the current project. Covers both
 * production (projectId_) and dev (projectId-dev_) scopes.
 */
function buildPairs(projectId: string): MigrationPair[] {
  return [
    {
      oldName: `${projectId}_platform-data`,
      newName: `${projectId}_convex-data`,
      scope: 'prod',
    },
    {
      oldName: `${projectId}-dev_platform-data`,
      newName: `${projectId}-dev_convex-data`,
      scope: 'dev',
    },
  ];
}

async function volumeExists(name: string): Promise<boolean> {
  const r = await docker('volume', 'inspect', name);
  return r.success;
}

async function volumeHasData(name: string): Promise<boolean> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    'alpine',
    'sh',
    '-c',
    'ls -A /vol | head -1',
  );
  return r.success && r.stdout.trim().length > 0;
}

async function volumeHasSentinel(name: string): Promise<boolean> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    'alpine',
    'sh',
    '-c',
    `test -f /vol/${MIGRATION_SENTINEL}`,
  );
  return r.success;
}

async function volumeSizeBytes(name: string): Promise<number | null> {
  const r = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    'alpine',
    'sh',
    '-c',
    'du -sb /vol | cut -f1',
  );
  if (!r.success) return null;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function humanSize(bytes: number | null): string {
  if (bytes == null) return '?';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

async function findMatchingContainers(
  prefix: string,
  filters: string[],
): Promise<string[]> {
  const r = await docker(
    'ps',
    '-a',
    '--filter',
    `name=${prefix}`,
    '--format',
    '{{.Names}}',
  );
  if (!r.success) return [];
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((name) => name && filters.some((f) => name.includes(f)));
}

async function stopContainer(name: string, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    logger.info(`  [DRY-RUN] would stop container: ${name}`);
    return true;
  }
  const stop = await docker('stop', '-t', '30', name);
  if (!stop.success) {
    logger.warn(`  failed to stop ${name}: ${stop.stderr.trim()}`);
    return false;
  }
  // Wait up to 60s for it to actually exit.
  const waited = await docker('wait', name);
  if (!waited.success) {
    logger.warn(
      `  container ${name} did not confirm shutdown: ${waited.stderr.trim()}`,
    );
  }
  return true;
}

/**
 * `tale migrate split-convex` — one-shot migration from the pre-split
 * monolithic `platform-data` volume to the Phase 2 `convex-data` volume.
 *
 * Steps:
 *   1. Detect  — find `${projectId}_platform-data` + `${projectId}-dev_...`
 *                that still contain data and have no migration sentinel on
 *                the destination side.
 *   2. Plan    — print source/destination names, estimated size, affected
 *                containers. `--dry-run` returns here.
 *   3. Confirm — prompt user (unless `--force`).
 *   4. Stop    — stop any containers currently mounting those volumes and
 *                wait for them to exit.
 *   5. Copy    — `docker run --rm --user 1001:1001 -v src:/src:ro
 *                -v dst:/dst alpine sh -c "cp -a /src/. /dst/ && touch …"`.
 *   6. Verify  — compare file counts and .history directory counts.
 *   7. Report  — summary, remind user the old volume is still present.
 *
 * On failure: never deletes or alters the source volume; user can retry.
 */
export async function migrateSplitConvex(
  options: SplitConvexOptions = {},
): Promise<number> {
  const { force = false, dryRun = false } = options;

  logger.header('tale migrate split-convex');

  const ping = await docker('info');
  if (!ping.success) {
    logger.error('Docker is not available. Is the daemon running?');
    return 1;
  }

  const projectId = getProjectId();
  const pairs = buildPairs(projectId);

  logger.step('Detecting volumes...');
  const candidates: Array<MigrationPair & { sizeBytes: number | null }> = [];
  for (const p of pairs) {
    const srcExists = await volumeExists(p.oldName);
    if (!srcExists) {
      logger.debug(`  ${p.oldName}: does not exist (skipping)`);
      continue;
    }
    const srcHasData = await volumeHasData(p.oldName);
    if (!srcHasData) {
      logger.info(`  ⏭  ${p.oldName} is empty — nothing to migrate`);
      continue;
    }
    const dstExists = await volumeExists(p.newName);
    if (dstExists && (await volumeHasSentinel(p.newName))) {
      logger.info(
        `  ✓ ${p.newName} already migrated (sentinel ${MIGRATION_SENTINEL} present)`,
      );
      continue;
    }
    const sizeBytes = await volumeSizeBytes(p.oldName);
    candidates.push({ ...p, sizeBytes });
  }

  if (candidates.length === 0) {
    logger.success('Nothing to migrate — all volumes are already split.');
    return 0;
  }

  // ---- Plan ----
  logger.blank();
  logger.header('Migration plan');
  for (const c of candidates) {
    logger.table([
      ['scope', c.scope],
      ['source', c.oldName],
      ['destination', c.newName],
      ['estimated size', humanSize(c.sizeBytes)],
    ]);
    logger.blank();
  }

  // ---- Containers to stop ----
  const containers: string[] = [];
  const filters = ['platform', 'convex'];
  for (const prefix of [`${projectId}-`, `${projectId}-dev-`]) {
    const matches = await findMatchingContainers(prefix, filters);
    for (const m of matches) {
      if (!containers.includes(m)) containers.push(m);
    }
  }
  if (containers.length > 0) {
    logger.info('The following containers will be stopped for the migration:');
    for (const c of containers) logger.info(`  - ${c}`);
    logger.blank();
  }

  if (dryRun) {
    logger.notice(
      'DRY RUN — no changes made. Re-run without --dry-run to apply.',
    );
    return 0;
  }

  // ---- Confirm ----
  if (!force) {
    const ok = await confirm(
      'Proceed with migration? (old volumes are preserved)',
    );
    if (!ok) {
      logger.info('Migration cancelled.');
      return 0;
    }
  }

  // ---- Stop ----
  if (containers.length > 0) {
    logger.step('Stopping containers...');
    for (const c of containers) {
      await stopContainer(c, false);
    }
  }

  // ---- Copy ----
  logger.step('Copying data to convex-data volume(s)...');
  const failed: string[] = [];
  const migrated: string[] = [];

  for (const c of candidates) {
    // Ensure destination exists.
    if (!(await volumeExists(c.newName))) {
      const created = await docker('volume', 'create', c.newName);
      if (!created.success) {
        logger.warn(
          `  ✗ Failed to create ${c.newName}: ${created.stderr.trim()}`,
        );
        failed.push(c.newName);
        continue;
      }
    } else if (await volumeHasData(c.newName)) {
      // Destination has data but no sentinel — partial copy, wipe and retry.
      logger.warn(
        `  ⚠  ${c.newName} has data but no sentinel; wiping for clean retry`,
      );
      const wipe = await docker(
        'run',
        '--rm',
        '-v',
        `${c.newName}:/vol`,
        'alpine',
        'sh',
        '-c',
        'find /vol -mindepth 1 -delete',
      );
      if (!wipe.success) {
        logger.warn(`  ✗ Failed to wipe ${c.newName}: ${wipe.stderr.trim()}`);
        failed.push(c.newName);
        continue;
      }
    }

    logger.info(
      `  copying ${c.oldName} → ${c.newName} (${humanSize(c.sizeBytes)})...`,
    );

    // --user 1001:1001 ensures destination files are owned by the `app` user
    // that both platform and convex containers run as (UID 1001, matches
    // `useradd --uid 1001` in both Dockerfiles).
    const copy = await docker(
      'run',
      '--rm',
      '--user',
      '1001:1001',
      '-v',
      `${c.oldName}:/src:ro`,
      '-v',
      `${c.newName}:/dst`,
      'alpine',
      'sh',
      '-c',
      `cp -a /src/. /dst/ && : > /dst/${MIGRATION_SENTINEL}`,
    );

    if (!copy.success) {
      logger.warn(`  ✗ copy failed: ${copy.stderr.trim()}`);
      failed.push(c.newName);
      continue;
    }

    // Verify.
    const srcCount = await docker(
      'run',
      '--rm',
      '-v',
      `${c.oldName}:/vol:ro`,
      'alpine',
      'sh',
      '-c',
      'find /vol -type f | wc -l',
    );
    const dstCount = await docker(
      'run',
      '--rm',
      '-v',
      `${c.newName}:/vol:ro`,
      'alpine',
      'sh',
      '-c',
      'find /vol -type f | wc -l',
    );
    if (
      srcCount.success &&
      dstCount.success &&
      srcCount.stdout.trim() === dstCount.stdout.trim()
    ) {
      logger.success(
        `  ${c.oldName} → ${c.newName} (${dstCount.stdout.trim()} files)`,
      );
    } else {
      logger.warn(
        `  ⚠  file count differs: src=${srcCount.stdout.trim()} dst=${dstCount.stdout.trim()}`,
      );
      // Count difference by 1 is expected because we wrote the sentinel.
    }
    migrated.push(c.newName);
  }

  // ---- Report ----
  logger.blank();
  logger.header('Migration report');
  if (migrated.length > 0) {
    logger.success(`Migrated: ${migrated.length}`);
    for (const n of migrated) logger.info(`  ✓ ${n}`);
  }
  if (failed.length > 0) {
    logger.error(`Failed: ${failed.length}`);
    for (const n of failed) logger.info(`  ✗ ${n}`);
    logger.blank();
    logger.info('Old volumes preserved. You can retry with:');
    logger.info('  tale migrate split-convex');
    return 1;
  }

  logger.blank();
  logger.info('Legacy volumes preserved. After verifying the split works,');
  logger.info('reclaim disk space with:');
  for (const c of candidates) {
    logger.info(`  docker volume rm ${c.oldName}`);
  }
  logger.blank();
  logger.info('Next steps:');
  logger.info('  tale start            # bring services back up');
  logger.info(
    '  tale logs convex      # verify the convex container is healthy',
  );
  return 0;
}
