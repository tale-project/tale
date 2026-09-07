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
  CONFIG_VOLUME,
  LEGACY_CONFIG_VOLUME,
  RESTORABLE_ARCHIVES,
  isValidSnapshotId,
  restoreTargetVolume,
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
import { listComposeContainers } from '../docker/list-service-containers';
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
  listComposeContainers: typeof listComposeContainers;
  stopContainer: typeof stopContainer;
}

const DEFAULT_DEPS: RestoreDeps = {
  listSnapshots,
  resolveSnapshotPrefix,
  verifySnapshot,
  isContainerRunning,
  listComposeContainers,
  stopContainer,
};

/**
 * Every container this project can be running: the stateful tier and the dev
 * stack by their pinned names, and both colours by their compose project —
 * a colour is a replica set with compose-numbered names, so the project
 * label is the only handle that finds all of them.
 */
async function findRunningProjectContainers(
  deps: RestoreDeps,
): Promise<string[]> {
  const projectId = getProjectId();
  const running: string[] = [];
  const named: string[] = [];
  for (const service of [...STATEFUL_SERVICES, ...SIDECAR_SERVICES]) {
    named.push(`${projectId}-${service}`);
  }
  // The dev stack pins its names; production runs the same services inside a
  // colour, found by label below.
  for (const service of ROTATABLE_SERVICES) {
    named.push(`${projectId}-${service}`);
  }
  for (const name of named) {
    if (await deps.isContainerRunning(name)) {
      running.push(name);
    }
  }
  for (const color of ['blue', 'green'] as const) {
    for (const container of await deps.listComposeContainers(
      `${projectId}-${color}`,
    )) {
      if (container.running) running.push(container.name);
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

    // Restore only archive names the CLI itself writes — a tampered manifest
    // must not be able to address arbitrary volumes. Each is paired with the
    // LIVE volume it belongs in: a snapshot from before the config-volume
    // rename filed the config tree as `convex-data.tar.gz`, and it restores
    // into today's `config-data`.
    const archives = Object.keys(manifest.volumes)
      .filter((archive) =>
        (RESTORABLE_ARCHIVES as readonly string[]).includes(archive),
      )
      .map((archive) => ({ archive, volume: restoreTargetVolume(archive) }))
      // A manifest carrying BOTH config archive names would restore one over
      // the other; keep the current name and say the older one is ignored.
      .filter((entry, _index, all) => {
        if (entry.archive !== LEGACY_CONFIG_VOLUME) return true;
        const superseded = all.some((other) => other.archive === CONFIG_VOLUME);
        if (superseded) {
          logger.warn(
            `Snapshot ${snapshotId} carries both ${LEGACY_CONFIG_VOLUME} and ${CONFIG_VOLUME} archives — restoring ${CONFIG_VOLUME} and ignoring the older one.`,
          );
        }
        return !superseded;
      });
    if (archives.length === 0) {
      throw new Error(`Snapshot ${snapshotId} contains no restorable volumes`);
    }
    const volumes = archives.map((entry) => entry.volume);
    // Snapshots from before blobs were captured — and snapshots of a
    // deployment whose blobs live in external S3 — carry no blob archive.
    // Restore what the snapshot has; say what it does not touch.
    if (!volumes.includes(BLOB_VOLUME)) {
      logger.notice(
        `Snapshot ${snapshotId} has no ${BLOB_VOLUME} archive (taken before blobs were captured, or with an external blob store) — the blob volume is left untouched.`,
      );
    }
    // The config store has no such excuse: every snapshot the CLI has ever
    // written captured it, so a manifest without one is a torn snapshot and
    // restoring it would leave the deployment with no organization config.
    if (!volumes.includes(CONFIG_VOLUME)) {
      logger.warn(
        `Snapshot ${snapshotId} has no ${CONFIG_VOLUME} (or ${LEGACY_CONFIG_VOLUME}) archive — the org config store is left untouched. This snapshot is incomplete.`,
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

    for (const { archive, volume } of archives) {
      logger.step(
        `Restoring ${prefix}${volume}${archive === volume ? '' : ` (from ${archive}.tar.gz)`}...`,
      );
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
          `test -f /backup/${snapshotId}/${archive}.tar.gz && find /data -mindepth 1 -delete && tar xzf /backup/${snapshotId}/${archive}.tar.gz -C /data`,
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
