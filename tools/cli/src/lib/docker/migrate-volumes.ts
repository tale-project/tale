import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import * as logger from '../../utils/logger';
import { docker } from './docker';

const LEGACY_PROJECT_NAME = 'tale';

// Volume mappings for migration. Keys are the new volume name (under the new
// project ID); values are the old volume name (under the hardcoded 'tale' /
// 'tale-dev' prefix).
function buildVolumeMapping(
  projectId: string,
): Array<{ oldName: string; newName: string }> {
  const devVolumes = [
    'platform-data',
    'db-data',
    'db-backup',
    'rag-data',
    'crawler-data',
    'caddy-data',
    'caddy-config',
  ];
  const prodVolumes = [
    'platform-data',
    'caddy-data',
    'rag-data',
    'crawler-data',
    'db-data',
    'db-backup',
  ];
  const pairs: Array<{ oldName: string; newName: string }> = [];
  for (const v of devVolumes) {
    pairs.push({
      oldName: `${LEGACY_PROJECT_NAME}-dev_${v}`,
      newName: `${projectId}-dev_${v}`,
    });
  }
  for (const v of prodVolumes) {
    pairs.push({
      oldName: `${LEGACY_PROJECT_NAME}_${v}`,
      newName: `${projectId}_${v}`,
    });
  }
  return pairs;
}

async function volumeExists(name: string): Promise<boolean> {
  const result = await docker('volume', 'inspect', name);
  return result.success;
}

async function volumeHasData(name: string): Promise<boolean> {
  // Use a minimal image to list contents. Caller guarantees volume exists.
  const result = await docker(
    'run',
    '--rm',
    '-v',
    `${name}:/vol:ro`,
    'alpine',
    'sh',
    '-c',
    'ls -A /vol | head -1',
  );
  return result.success && result.stdout.trim().length > 0;
}

/** Find a locally-available image suitable for volume copying. */
async function resolveMigrationImage(): Promise<string> {
  // Prefer images that are guaranteed present after any prior Tale run.
  // Caveat: `docker image inspect <tag>` works for any image with that tag,
  // regardless of registry.
  const candidates = ['tale-platform', 'tale-proxy', 'alpine'];
  for (const candidate of candidates) {
    // Try exact match first
    const exact = await docker('image', 'inspect', candidate);
    if (exact.success) return candidate;
    // Try any tag with this repo substring
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
  // Final fallback: alpine — may trigger a pull.
  return 'alpine';
}

interface RunningContainersResult {
  containers: string[];
  hasLegacy: boolean;
}

/** Detect running containers with the legacy 'tale-*' naming convention. */
async function detectRunningLegacyContainers(): Promise<RunningContainersResult> {
  const result = await docker(
    'ps',
    '--filter',
    'name=tale-',
    '--format',
    '{{.Names}}',
  );
  if (!result.success) return { containers: [], hasLegacy: false };

  // Only match exact legacy container names (not the new project-ID containers
  // that might coincidentally start with "tale-").
  const legacyPattern =
    /^tale(-(dev|blue|green))?-(platform|db|rag|crawler|proxy)(-(blue|green))?$/;
  const containers = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((name) => name && legacyPattern.test(name));
  return { containers, hasLegacy: containers.length > 0 };
}

interface MigrationResult {
  migrated: string[];
  failed: string[];
  skipped: string[];
  deferred: boolean;
}

function markerPath(projectDir: string): string {
  return join(projectDir, '.tale', 'migration-pending');
}

async function writeMigrationPending(projectDir: string): Promise<void> {
  const path = markerPath(projectDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new Date().toISOString() + '\n');
}

export function hasPendingMigration(projectDir: string): boolean {
  return existsSync(markerPath(projectDir));
}

export async function clearMigrationPending(projectDir: string): Promise<void> {
  await unlink(markerPath(projectDir)).catch(() => {});
}

/**
 * Migrate legacy 'tale_*' and 'tale-dev_*' volumes to the new project-scoped
 * names. Never stops running containers — if legacy containers are live
 * (especially production), defers via a marker file.
 */
export async function migrateOldVolumes(
  projectId: string,
  projectDir: string,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    migrated: [],
    failed: [],
    skipped: [],
    deferred: false,
  };

  // Safety check 1: Docker must be running
  const ping = await docker('info');
  if (!ping.success) {
    logger.warn(
      'Docker is not available. Volume migration deferred until next "tale start" or "tale deploy".',
    );
    await writeMigrationPending(projectDir);
    result.deferred = true;
    return result;
  }

  // Safety check 2: never disturb running containers
  const running = await detectRunningLegacyContainers();
  if (running.hasLegacy) {
    logger.warn(
      'Legacy Tale containers are running — volume migration deferred.',
    );
    for (const name of running.containers) {
      logger.info(`  - ${name}`);
    }
    logger.info(
      'Migration will run automatically during next "tale start", or with "tale deploy --migrate-volumes".',
    );
    await writeMigrationPending(projectDir);
    result.deferred = true;
    return result;
  }

  // Check whether any legacy volumes exist at all
  const mapping = buildVolumeMapping(projectId);
  const candidates: Array<{ oldName: string; newName: string }> = [];
  for (const pair of mapping) {
    if (await volumeExists(pair.oldName)) {
      candidates.push(pair);
    }
  }

  if (candidates.length === 0) {
    logger.debug('No legacy volumes found, nothing to migrate.');
    return result;
  }

  logger.step(`Migrating ${candidates.length} legacy volume(s)...`);
  const image = await resolveMigrationImage();

  for (const { oldName, newName } of candidates) {
    // Idempotency: if destination already has data, skip.
    if ((await volumeExists(newName)) && (await volumeHasData(newName))) {
      logger.info(
        `  ⏭  ${oldName} → ${newName} (destination has data, skipping)`,
      );
      result.skipped.push(newName);
      continue;
    }

    // Create destination volume if absent
    if (!(await volumeExists(newName))) {
      const created = await docker('volume', 'create', newName);
      if (!created.success) {
        logger.warn(
          `  ✗ Failed to create volume ${newName}: ${created.stderr}`,
        );
        result.failed.push(newName);
        continue;
      }
    }

    // Copy data via a throwaway container. Mount old read-only as safety.
    const copy = await docker(
      'run',
      '--rm',
      '-v',
      `${oldName}:/old:ro`,
      '-v',
      `${newName}:/new`,
      '--entrypoint',
      'sh',
      image,
      '-c',
      'cp -a /old/. /new/',
    );

    if (copy.success) {
      logger.info(`  ✓ ${oldName} → ${newName}`);
      result.migrated.push(newName);
    } else {
      logger.warn(`  ✗ ${oldName} → ${newName}: ${copy.stderr}`);
      result.failed.push(newName);
    }
  }

  if (result.migrated.length > 0) {
    logger.blank();
    logger.info('Old volumes preserved. After verifying, reclaim disk with:');
    const oldNames = candidates.map((p) => p.oldName).join(' ');
    logger.info(`  docker volume rm ${oldNames}`);
  }

  return result;
}
