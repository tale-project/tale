import { formatBytes } from '../../utils/format-bytes';
import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { resolveConsent } from '../../utils/output-mode';
import { confirm } from '../../utils/prompt';
import {
  archiveTimeoutSeconds,
  BACKUP_HELPER_IMAGE,
  BACKUP_VOLUME,
  BLOB_VOLUME,
  SNAPSHOT_VOLUMES,
  isValidSnapshotId,
} from '../backup/constants';
import type { SnapshotManifest } from '../backup/create-snapshot';
import { listSnapshots } from '../backup/list-snapshots';
import { resolveSnapshotPrefix } from '../backup/resolve-prefix';
import { verifySnapshot } from '../backup/verify-snapshot';
import {
  ROTATABLE_SERVICES,
  SIDECAR_SERVICES,
  STATEFUL_SERVICES,
} from '../compose/types';
import { ensureVolumes } from '../docker/ensure-volumes';
import { exec } from '../docker/exec';
import { isContainerRunning } from '../docker/is-container-running';
import { stopContainer } from '../docker/stop-container';
import { withLock } from '../state/with-lock';

interface RestoreOptions {
  env: DeploymentEnv;
  /** Omitted = list available snapshots and exit. */
  snapshotId?: string;
  /** Stop running project containers instead of refusing. */
  stop?: boolean;
  /** Non-interactive: skip the confirmation prompt. */
  assumeYes?: boolean;
}

/**
 * The collaborators `restore` drives, injectable so its tests can script them
 * without module-mocking the sibling modules (`list-snapshots`,
 * `verify-snapshot`) that carry their own test files — bun's `mock.module`
 * is process-wide, so a mock installed here would leak into those suites and
 * hand them a mock where they expect the real implementation.
 */
export interface RestoreDeps {
  listSnapshots: typeof listSnapshots;
  resolveSnapshotPrefix: typeof resolveSnapshotPrefix;
  verifySnapshot: typeof verifySnapshot;
  isContainerRunning: typeof isContainerRunning;
  stopContainer: typeof stopContainer;
}

const DEFAULT_DEPS: RestoreDeps = {
  listSnapshots,
  resolveSnapshotPrefix,
  verifySnapshot,
  isContainerRunning,
  stopContainer,
};

/**
 * Every container name this project can run: stateful (one instance each),
 * rotatable both uncolored (dev stack) and per blue/green color (prod stack).
 */
async function findRunningProjectContainers(
  deps: RestoreDeps,
): Promise<string[]> {
  const projectId = getProjectId();
  const candidates: string[] = [];
  for (const service of [...STATEFUL_SERVICES, ...SIDECAR_SERVICES]) {
    candidates.push(`${projectId}-${service}`);
  }
  for (const service of ROTATABLE_SERVICES) {
    candidates.push(`${projectId}-${service}`);
    candidates.push(`${projectId}-${service}-blue`);
    candidates.push(`${projectId}-${service}-green`);
  }
  const running: string[] = [];
  for (const name of candidates) {
    if (await deps.isContainerRunning(name)) {
      running.push(name);
    }
  }
  return running;
}

function totalSizeBytes(manifest: SnapshotManifest): number {
  return Object.values(manifest.volumes).reduce(
    (sum, info) => sum + info.sizeBytes,
    0,
  );
}

function hasBlobArchive(manifest: SnapshotManifest): boolean {
  return BLOB_VOLUME in manifest.volumes;
}

function printSnapshotList(snapshots: SnapshotManifest[]): void {
  logger.table(
    snapshots.map((snapshot) => [
      snapshot.id,
      `${snapshot.createdAt} · platform ${snapshot.platformVersion ?? 'unknown'} · ${formatBytes(totalSizeBytes(snapshot))} · ${snapshot.trigger}${hasBlobArchive(snapshot) ? '' : ' · without blobs'}`,
    ]),
  );
}

export async function restore(
  options: RestoreOptions,
  deps: RestoreDeps = DEFAULT_DEPS,
): Promise<void> {
  const { env, snapshotId } = options;

  const prefix = await deps.resolveSnapshotPrefix();
  if (!prefix) {
    throw new Error(
      'No Tale data volumes found for this project — nothing to restore into. ' +
        'On a fresh host, run `tale deploy` once (or `tale dev` for a dev stack) ' +
        'to create the volume set, then restore.',
    );
  }

  const snapshots = await deps.listSnapshots(prefix);

  if (!snapshotId) {
    logger.header('Available Snapshots');
    if (snapshots.length === 0) {
      logger.info(`No snapshots found in ${prefix}${BACKUP_VOLUME}.`);
      logger.info('Create one with: tale backup');
      return;
    }
    printSnapshotList(snapshots);
    logger.blank();
    logger.info(
      'Restore with: tale restore <snapshot-id> (the stack must be stopped; add --stop to stop it)',
    );
    return;
  }

  if (!isValidSnapshotId(snapshotId)) {
    throw new Error(
      `Invalid snapshot id "${snapshotId}" — run \`tale restore\` to list available snapshots.`,
    );
  }
  const manifest = snapshots.find((snapshot) => snapshot.id === snapshotId);
  if (!manifest) {
    throw new Error(
      `Snapshot ${snapshotId} not found in ${prefix}${BACKUP_VOLUME} — run \`tale restore\` to list available snapshots.`,
    );
  }

  await withLock(env.DEPLOY_DIR, `restore ${snapshotId}`, async () => {
    logger.header(`Restoring Snapshot ${snapshotId}`);

    // Restoring under a live stack guarantees corruption — Postgres would
    // be rewritten underneath a running postmaster. Refuse unless stopped.
    const running = await findRunningProjectContainers(deps);
    if (running.length > 0) {
      if (!options.stop) {
        throw new Error(
          `Refusing to restore while project containers are running: ${running.join(', ')}.\n` +
            '  Stop them first, or re-run with --stop.',
        );
      }
      logger.step('Stopping running project containers...');
      for (const name of running) {
        const stopped = await deps.stopContainer(name);
        if (!stopped) {
          throw new Error(`Failed to stop ${name} — aborting restore.`);
        }
      }
    }

    // Restore only volume names the CLI itself snapshots — a tampered
    // manifest must not be able to address arbitrary volumes.
    const volumes = Object.keys(manifest.volumes).filter((volume) =>
      (SNAPSHOT_VOLUMES as readonly string[]).includes(volume),
    );
    if (volumes.length === 0) {
      throw new Error(`Snapshot ${snapshotId} contains no restorable volumes`);
    }
    // Snapshots from before blobs were captured — and snapshots of a
    // deployment whose blobs live in external S3 — carry no blob archive.
    // Restore what the snapshot has; say what it does not touch.
    if (!volumes.includes(BLOB_VOLUME)) {
      logger.notice(
        `Snapshot ${snapshotId} has no ${BLOB_VOLUME} archive (taken before blobs were captured, or with an external blob store) — the blob volume is left untouched.`,
      );
    }

    if (!resolveConsent(options.assumeYes)) {
      logger.warn(
        `This wipes the current contents of: ${volumes.map((volume) => `${prefix}${volume}`).join(', ')}`,
      );
      logger.warn(
        `and replaces them with snapshot ${snapshotId} (created ${manifest.createdAt}, platform ${manifest.platformVersion ?? 'unknown'}).`,
      );
      const ok = await confirm({ message: 'Restore now?', default: false });
      if (!ok) {
        throw new Error('Restore aborted');
      }
    }

    logger.step('Verifying snapshot integrity...');
    await deps.verifySnapshot(prefix, manifest);

    // Fresh-host case: re-create any missing target volumes first.
    const volumesReady = await ensureVolumes(volumes, prefix);
    if (!volumesReady) {
      throw new Error('Failed to create target volumes');
    }

    for (const volume of volumes) {
      logger.step(`Restoring ${prefix}${volume}...`);
      const result = await exec(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${prefix}${volume}:/data`,
          '-v',
          `${prefix}${BACKUP_VOLUME}:/backup:ro`,
          BACKUP_HELPER_IMAGE,
          'sh',
          '-c',
          // Never wipe the live volume for an archive that is not there:
          // the existence check runs BEFORE the delete, inside the same
          // helper container that will extract.
          `test -f /backup/${snapshotId}/${volume}.tar.gz && find /data -mindepth 1 -delete && tar xzf /backup/${snapshotId}/${volume}.tar.gz -C /data`,
        ],
        { timeout: archiveTimeoutSeconds(volume) },
      );
      if (!result.success) {
        throw new Error(
          `Restore of ${prefix}${volume} failed: ${result.stderr || result.stdout}\n` +
            '  The volume may be partially restored — re-run the restore before starting the stack.',
        );
      }
    }

    logger.success(`Snapshot ${snapshotId} restored.`);
    logger.blank();
    logger.info('Bring the stack back on the version that matches the data:');
    if (prefix.endsWith('-dev_')) {
      logger.info('  tale dev');
    } else {
      logger.info(
        `  tale update --version ${manifest.platformVersion ?? '<version-at-snapshot-time>'}`,
      );
      logger.info('  tale deploy --stop');
    }
  });
}
