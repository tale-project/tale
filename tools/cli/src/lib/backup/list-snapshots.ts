import * as logger from '../../utils/logger';
import { volumeExists } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import {
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  isValidSnapshotId,
} from './constants';
import {
  type SnapshotManifest,
  type SnapshotTrigger,
  type SnapshotVolumeInfo,
  SNAPSHOT_TRIGGERS,
} from './create-snapshot';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isVolumeInfo(value: unknown): value is SnapshotVolumeInfo {
  return (
    isRecord(value) &&
    typeof value.sha256 === 'string' &&
    typeof value.sizeBytes === 'number'
  );
}

function isTrigger(value: unknown): value is SnapshotTrigger {
  return (
    typeof value === 'string' &&
    (SNAPSHOT_TRIGGERS as readonly string[]).includes(value)
  );
}

function parseManifest(raw: string): SnapshotManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `Skipping unparseable snapshot manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isValidSnapshotId(value.id) ||
    typeof value.createdAt !== 'string' ||
    typeof value.cliVersion !== 'string' ||
    (value.platformVersion !== null &&
      typeof value.platformVersion !== 'string') ||
    !isTrigger(value.trigger) ||
    !isRecord(value.volumes)
  ) {
    logger.warn(`Skipping snapshot manifest with invalid shape: ${raw}`);
    return null;
  }

  const volumes: Record<string, SnapshotVolumeInfo> = {};
  for (const [name, info] of Object.entries(value.volumes)) {
    if (!isVolumeInfo(info)) {
      logger.warn(
        `Skipping snapshot ${value.id}: invalid volume entry "${name}"`,
      );
      return null;
    }
    volumes[name] = info;
  }

  return {
    id: value.id,
    createdAt: value.createdAt,
    cliVersion: value.cliVersion,
    platformVersion: value.platformVersion ?? null,
    trigger: value.trigger,
    volumes,
  };
}

/**
 * Read every complete snapshot manifest from the project's backups volume,
 * newest first. Directories without a manifest (torn snapshots) and
 * manifests that fail validation are skipped with a warning. Returns []
 * when the backups volume does not exist yet.
 */
export async function listSnapshots(
  prefix: string,
): Promise<SnapshotManifest[]> {
  const backupVolume = `${prefix}${BACKUP_VOLUME}`;
  if (!(await volumeExists(backupVolume))) {
    return [];
  }

  const result = await exec('docker', [
    'run',
    '--rm',
    '-v',
    `${backupVolume}:/backup:ro`,
    BACKUP_HELPER_IMAGE,
    'sh',
    '-c',
    // One single-line JSON manifest per line; `true` keeps the exit code 0
    // when the volume is empty (the glob then matches nothing).
    'for f in /backup/*/manifest.json; do [ -f "$f" ] && cat "$f" && echo; done; true',
  ]);
  if (!result.success) {
    throw new Error(
      `Failed to list snapshots in ${backupVolume}: ${result.stderr}`,
    );
  }

  const manifests: SnapshotManifest[] = [];
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const manifest = parseManifest(trimmed);
    if (manifest) manifests.push(manifest);
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return manifests;
}
