import pkg from '../../../package.json';
import { formatBytes } from '../../utils/format-bytes';
import * as logger from '../../utils/logger';
import { ensureVolumes, volumeExists } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import {
  listContainersUsingVolume,
  withVolumeContainersPaused,
} from '../docker/with-volume-paused';
import {
  archiveTimeoutSeconds,
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  BLOB_VOLUME,
  CONFIG_VOLUME,
  LEGACY_CONFIG_VOLUME,
  SNAPSHOT_VOLUMES,
} from './constants';
import { type BlobStoreLayout, inspectBlobStore } from './inspect-blob-store';

export const SNAPSHOT_TRIGGERS = [
  'deploy',
  'start',
  'update',
  'manual',
] as const;
export type SnapshotTrigger = (typeof SNAPSHOT_TRIGGERS)[number];

export interface SnapshotVolumeInfo {
  sha256: string;
  sizeBytes: number;
}

export interface SnapshotManifest {
  id: string;
  createdAt: string;
  cliVersion: string;
  platformVersion: string | null;
  trigger: SnapshotTrigger;
  volumes: Record<string, SnapshotVolumeInfo>;
}

interface CreateSnapshotOptions {
  /** Volume namespace: `${projectId}_` (prod) or `${projectId}-dev_` (dev). */
  prefix: string;
  trigger: SnapshotTrigger;
  /** Version of the running platform container, when determinable. */
  platformVersion: string | null;
  /**
   * When true and none of the SNAPSHOT_VOLUMES exist under `prefix`, warn
   * and return null instead of throwing. Used by the legacy-layout
   * preflight, where "no volumes yet" means there is nothing to protect.
   */
  allowMissingVolumes?: boolean;
}

function newSnapshotId(trigger: SnapshotTrigger, now = new Date()): string {
  const iso = now.toISOString(); // e.g. 2026-06-11T14:25:30.123Z
  const date = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `${date}-${time}-${trigger}`;
}

/**
 * Tar one volume into the backups volume and return its integrity info. The
 * caller holds every running container that has the volume mounted paused,
 * so the archive is crash-consistent — a live tar of a running Postgres data
 * dir is not restorable.
 */
async function archiveVolume(
  prefix: string,
  backupVolume: string,
  id: string,
  volume: string,
  pausedCount: number,
): Promise<SnapshotVolumeInfo> {
  const volumeName = `${prefix}${volume}`;
  const tarResult = await exec(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${volumeName}:/data:ro`,
      '-v',
      `${backupVolume}:/backup`,
      BACKUP_HELPER_IMAGE,
      'sh',
      '-c',
      // tee writes the .sha256 sidecar AND echoes it so sha256 + byte size
      // are parseable from the last two stdout lines below.
      `mkdir -p /backup/${id} && tar czf /backup/${id}/${volume}.tar.gz -C /data . && cd /backup/${id} && sha256sum ${volume}.tar.gz | tee ${volume}.tar.gz.sha256 && wc -c < ${volume}.tar.gz`,
    ],
    { timeout: archiveTimeoutSeconds(volume) },
  );
  if (!tarResult.success) {
    throw new Error(
      `Snapshot of volume ${volumeName} failed: ${tarResult.stderr || tarResult.stdout}`,
    );
  }

  const lines = tarResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const shaLine = lines[lines.length - 2] ?? '';
  const sizeLine = lines[lines.length - 1] ?? '';
  const sha256 = shaLine.split(/\s+/)[0] ?? '';
  const sizeBytes = Number.parseInt(sizeLine, 10);
  if (!/^[0-9a-f]{64}$/.test(sha256) || Number.isNaN(sizeBytes)) {
    throw new Error(
      `Snapshot of ${volumeName} produced unparseable integrity output: "${tarResult.stdout}"`,
    );
  }

  logger.info(
    `  ${volume}: ${formatBytes(sizeBytes)}${pausedCount > 0 ? ` (${pausedCount} container(s) paused during tar)` : ''}`,
  );
  return { sha256, sizeBytes };
}

/**
 * Tar a run of volumes inside ONE pause of the containers that use them. The
 * pause typically lasts seconds; unpausing, and waiting until the containers
 * report healthy again, is guaranteed by withVolumeContainersPaused.
 */
async function snapshotVolumes(
  prefix: string,
  backupVolume: string,
  id: string,
  volumes: readonly string[],
): Promise<Record<string, SnapshotVolumeInfo>> {
  return withVolumeContainersPaused(
    volumes.map((volume) => `${prefix}${volume}`),
    async (pausedCount) => {
      const archived: Record<string, SnapshotVolumeInfo> = {};
      for (const volume of volumes) {
        archived[volume] = await archiveVolume(
          prefix,
          backupVolume,
          id,
          volume,
          pausedCount,
        );
      }
      return archived;
    },
  );
}

/**
 * Split the volumes, in order, into runs used by exactly the same containers
 * — in practice the proxy's `caddy-data` and `caddy-config`. Every pause costs
 * its containers a fresh health probe before they report healthy again, so
 * pausing the proxy once for both saves a whole probe interval, and the two
 * archives capture the same instant.
 */
async function pauseGroups(
  prefix: string,
  volumes: readonly string[],
): Promise<string[][]> {
  const groups: { users: string; volumes: string[] }[] = [];
  for (const volume of volumes) {
    const users = (await listContainersUsingVolume(`${prefix}${volume}`))
      .sort()
      .join(',');
    const previous = groups.at(-1);
    if (previous && users !== '' && previous.users === users) {
      previous.volumes.push(volume);
    } else {
      groups.push({ users, volumes: [volume] });
    }
  }
  return groups.map((group) => group.volumes);
}

/**
 * Say, once and plainly, which blobs a snapshot can NOT contain: those in an
 * external S3 the deployment default points at, and those in buckets
 * organizations bring themselves. Either way the operator's own backup of
 * that bucket is the only copy — silence here would read as "everything is
 * in the snapshot".
 */
function announceExternalBlobs(layout: BlobStoreLayout): void {
  switch (layout.default.kind) {
    case 'external':
      logger.notice(
        `Blobs live in external S3 (${layout.default.endpoint}, bucket "${layout.default.bucket}") — not in this snapshot: back that bucket up yourself; the local ${BLOB_VOLUME} volume is skipped.`,
      );
      break;
    case 'unknown':
      logger.debug(
        `Blob store layout unknown (${layout.default.reason}) — capturing ${BLOB_VOLUME} when present.`,
      );
      break;
    case 'bundled':
      break;
  }
  if (layout.ownBucketOrgs.length > 0) {
    logger.notice(
      `Blobs of ${layout.ownBucketOrgs.length} organization(s) with their own bucket (${layout.ownBucketOrgs.join(', ')}) live in those buckets — not in this snapshot: back them up under your own contract.`,
    );
  }
}

/**
 * Snapshot every existing data volume under `prefix` into the project's
 * backups volume. The manifest is written LAST — its presence marks the
 * snapshot complete. Listing and restore ignore manifest-less directories,
 * so a crash mid-tar can never surface as a restorable snapshot.
 *
 * The blob volume is one of the data volumes — uploads are as
 * non-rederivable as rows — unless the deployment default points at an
 * external S3, in which case the local volume holds nothing the app reads
 * and the operator is told the bucket is theirs to back up. Blobs of
 * organizations that bring their own bucket are named for the same reason.
 *
 * Throws on any failure (callers abort the surrounding deploy/migration);
 * returns null only in the `allowMissingVolumes` no-volumes case.
 */
export async function createSnapshot(
  options: CreateSnapshotOptions,
): Promise<SnapshotManifest | null> {
  const { prefix, trigger, platformVersion } = options;

  const blobStore = await inspectBlobStore(prefix);
  const candidates: readonly string[] =
    blobStore.default.kind === 'external'
      ? SNAPSHOT_VOLUMES.filter((volume) => volume !== BLOB_VOLUME)
      : SNAPSHOT_VOLUMES;

  const present: string[] = [];
  for (const volume of candidates) {
    if (volume === CONFIG_VOLUME) {
      // First upgrade: snapshot runs BEFORE the volume rename. Live org
      // config is still in `convex-data`. Snapshotting only `config-data`
      // would omit agents/SSO/governance from the recovery point.
      if (await volumeExists(`${prefix}${CONFIG_VOLUME}`)) {
        present.push(CONFIG_VOLUME);
      } else if (await volumeExists(`${prefix}${LEGACY_CONFIG_VOLUME}`)) {
        present.push(LEGACY_CONFIG_VOLUME);
      }
      continue;
    }
    if (await volumeExists(`${prefix}${volume}`)) {
      present.push(volume);
    }
  }
  if (present.length === 0) {
    const message = `No data volumes found under ${prefix}* — nothing to snapshot`;
    if (options.allowMissingVolumes) {
      logger.warn(`${message}.`);
      return null;
    }
    throw new Error(message);
  }

  const backupVolume = `${prefix}${BACKUP_VOLUME}`;
  const volumesReady = await ensureVolumes([BACKUP_VOLUME], prefix);
  if (!volumesReady) {
    throw new Error(`Failed to create backup volume ${backupVolume}`);
  }

  const id = newSnapshotId(trigger);
  logger.step(`Creating volume snapshot ${id} (${present.join(', ')})...`);
  announceExternalBlobs(blobStore);

  const volumes: Record<string, SnapshotVolumeInfo> = {};
  for (const group of await pauseGroups(prefix, present)) {
    Object.assign(
      volumes,
      await snapshotVolumes(prefix, backupVolume, id, group),
    );
  }

  const manifest: SnapshotManifest = {
    id,
    createdAt: new Date().toISOString(),
    cliVersion: pkg.version,
    platformVersion,
    trigger,
    volumes,
  };
  const writeResult = await exec(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '-v',
      `${backupVolume}:/backup`,
      BACKUP_HELPER_IMAGE,
      'sh',
      '-c',
      `cat > /backup/${id}/manifest.json`,
    ],
    { stdin: JSON.stringify(manifest) },
  );
  if (!writeResult.success) {
    throw new Error(
      `Failed to write snapshot manifest for ${id}: ${writeResult.stderr}`,
    );
  }

  const totalBytes = Object.values(volumes).reduce(
    (sum, info) => sum + info.sizeBytes,
    0,
  );
  logger.success(
    `Snapshot ${id} complete (${present.length} volume(s), ${formatBytes(totalBytes)})`,
  );
  return manifest;
}
