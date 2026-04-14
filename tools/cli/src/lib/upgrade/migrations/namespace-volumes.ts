import * as logger from '../../../utils/logger';
import { docker } from '../../docker/docker';
import type { Migration, MigrationContext } from '../types';
import {
  copyVolumeWithVerify,
  resolveMigrationImage,
  stopContainerOrThrow,
  volumeExists,
  volumeHasData,
} from '../volume-helpers';

/**
 * Pre-0.2.33 hard-coded project name. Volumes and containers from that era
 * were all prefixed with `tale_` / `tale-dev_` / `tale-blue_` / `tale-green_`
 * because `docker compose` used the fixed `-p tale` flag.
 */
const LEGACY_PROJECT_NAME = 'tale';

const DEV_VOLUMES = [
  'platform-data',
  'db-data',
  'db-backup',
  'rag-data',
  'crawler-data',
  'caddy-data',
  'caddy-config',
];
const PROD_VOLUMES = [
  'platform-data',
  'caddy-data',
  'caddy-config',
  'rag-data',
  'crawler-data',
  'db-data',
  'db-backup',
];

function buildPairs(
  projectId: string,
): Array<{ oldName: string; newName: string }> {
  const pairs: Array<{ oldName: string; newName: string }> = [];
  for (const v of DEV_VOLUMES) {
    pairs.push({
      oldName: `${LEGACY_PROJECT_NAME}-dev_${v}`,
      newName: `${projectId}-dev_${v}`,
    });
  }
  for (const v of PROD_VOLUMES) {
    pairs.push({
      oldName: `${LEGACY_PROJECT_NAME}_${v}`,
      newName: `${projectId}_${v}`,
    });
  }
  return pairs;
}

async function findRunningLegacyContainers(): Promise<string[]> {
  const r = await docker(
    'ps',
    '--filter',
    'name=tale-',
    '--format',
    '{{.Names}}',
  );
  if (!r.success) return [];
  const legacyPattern =
    /^tale(-(dev|blue|green))?-(platform|db|rag|crawler|proxy)(-(blue|green))?$/;
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((name) => name && legacyPattern.test(name));
}

/** Pairs where the end-state does NOT yet hold and there is something to copy.
 *
 *  End-state for this migration: the destination volume exists and has data.
 *  Therefore a pair is pending iff:
 *    - destination is absent or empty, AND
 *    - source exists and has data.
 *
 *  If the destination already has data we always skip — regardless of whether
 *  a sentinel is present, regardless of what legacy volumes sit on the host.
 *  This is the key idempotency guarantee: a project whose namespaced volumes
 *  were populated by the compose stack directly (v0.2.33+ fresh init, or a
 *  previous successful migration) must never be touched by this migration
 *  again, even if stray `tale-dev_*` volumes from unrelated installs exist. */
async function findPending(
  projectId: string,
  image: string,
): Promise<Array<{ oldName: string; newName: string }>> {
  const all = buildPairs(projectId);
  const pending: Array<{ oldName: string; newName: string }> = [];
  for (const p of all) {
    // End-state check first: if the destination already has data, this pair
    // is satisfied. We do not trust, nor require, the sentinel here — a
    // populated destination that predates the migration infrastructure
    // (v0.2.33 fresh inits) will legitimately lack one.
    if (
      (await volumeExists(p.newName)) &&
      (await volumeHasData(p.newName, image))
    ) {
      continue;
    }
    // Destination is absent or empty. Only migrate if there's actual source
    // data to copy — an empty source would just recreate an empty dst.
    if (!(await volumeExists(p.oldName))) continue;
    if (!(await volumeHasData(p.oldName, image))) continue;
    pending.push(p);
  }
  return pending;
}

export const namespaceVolumesMigration: Migration = {
  id: 'namespace-volumes',
  introducedIn: '0.2.33',
  description: (ctx: MigrationContext) =>
    `Rename legacy Docker volumes (tale_* / tale-dev_*) to the per-project scope (${ctx.projectId}_*).`,

  async detect(ctx: MigrationContext): Promise<boolean> {
    // Cheap shortcut: if no legacy source volume exists anywhere on the host,
    // there is nothing we could ever copy. Bail before pulling an image.
    const all = buildPairs(ctx.projectId);
    let anySourceExists = false;
    for (const p of all) {
      if (await volumeExists(p.oldName)) {
        anySourceExists = true;
        break;
      }
    }
    if (!anySourceExists) return false;
    // Otherwise defer to findPending — it applies the full end-state check
    // per pair and is the single source of truth for "do we have work?".
    const image = await resolveMigrationImage();
    return (await findPending(ctx.projectId, image)).length > 0;
  },

  async requiredStops(): Promise<string[]> {
    // Legacy compose project names we might need to bring down. These were
    // the only names in use pre-0.2.33.
    return ['tale', 'tale-blue', 'tale-green', 'tale-dev'];
  },

  async apply(ctx, { dryRun }) {
    if (dryRun) return 'noop';

    // Extra safety: never run while legacy containers are live. The runner
    // should already have stopped them via requiredStops → performStops, but
    // a running container here means the caller's stop logic didn't fully
    // cover the surface.
    const running = await findRunningLegacyContainers();
    if (running.length > 0) {
      // Stop them individually; if that fails, bail out loudly rather than
      // copying over a live volume.
      for (const name of running) await stopContainerOrThrow(name);
    }

    const image = await resolveMigrationImage();
    const pending = await findPending(ctx.projectId, image);
    if (pending.length === 0) return 'noop';

    for (const { oldName, newName } of pending) {
      logger.info(`  ${oldName} → ${newName}`);
      await copyVolumeWithVerify(oldName, newName, image);
    }

    logger.info('Old volumes preserved. After verifying, reclaim disk with:');
    const oldNames = pending.map((p) => p.oldName).join(' ');
    logger.info(`  docker volume rm ${oldNames}`);
    return 'applied';
  },
};
