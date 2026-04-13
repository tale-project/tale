import * as logger from '../../../utils/logger';
import { docker } from '../../docker/docker';
import type { Migration, MigrationContext } from '../types';
import {
  copyVolumeWithVerify,
  resolveMigrationImage,
  stopContainerOrThrow,
  volumeExists,
  volumeHasData,
  volumeHasSentinel,
} from '../volume-helpers';

interface SplitPair {
  oldName: string;
  newName: string;
  scope: 'prod' | 'dev';
}

function buildPairs(projectId: string): SplitPair[] {
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

/** Pairs for which we genuinely have work to do: the old platform-data
 *  volume exists and has data, and the new convex-data volume either does
 *  not exist or has not been sentinelled yet. */
async function findPending(
  projectId: string,
  image: string,
): Promise<SplitPair[]> {
  const pending: SplitPair[] = [];
  for (const p of buildPairs(projectId)) {
    if (!(await volumeExists(p.oldName))) continue;
    if (!(await volumeHasData(p.oldName, image))) continue;
    if (
      (await volumeExists(p.newName)) &&
      (await volumeHasSentinel(p.newName, image))
    ) {
      continue;
    }
    pending.push(p);
  }
  return pending;
}

async function findContainersUsingPlatformData(
  projectId: string,
): Promise<string[]> {
  // Match platform/convex containers under both prod and dev project scopes.
  const prefixes = [`${projectId}-`, `${projectId}-dev-`];
  const names: string[] = [];
  for (const prefix of prefixes) {
    const r = await docker(
      'ps',
      '-a',
      '--filter',
      `name=${prefix}`,
      '--format',
      '{{.Names}}',
    );
    if (!r.success) continue;
    for (const raw of r.stdout.split('\n')) {
      const n = raw.trim();
      if (!n) continue;
      if (!/(platform|convex)/.test(n)) continue;
      if (!names.includes(n)) names.push(n);
    }
  }
  return names;
}

export const splitConvexMigration: Migration = {
  id: 'split-convex',
  introducedIn: '0.3.0',
  description: (ctx: MigrationContext) =>
    `Copy ${ctx.projectId}_platform-data into ${ctx.projectId}_convex-data so the new dedicated Convex service can own its data volume.`,

  async detect(ctx: MigrationContext): Promise<boolean> {
    // Cheap check first: if neither legacy volume exists, nothing to do.
    const pairs = buildPairs(ctx.projectId);
    let anyExists = false;
    for (const p of pairs) {
      if (await volumeExists(p.oldName)) {
        anyExists = true;
        break;
      }
    }
    if (!anyExists) return false;
    const image = await resolveMigrationImage();
    return (await findPending(ctx.projectId, image)).length > 0;
  },

  async requiredStops(ctx): Promise<string[]> {
    // Individual container names, not compose project names — the runner
    // passes these through to its caller's stop routine. `tale deploy` /
    // `tale start` both issue `docker compose -p <project> down` for compose
    // projects; for individual containers we still want them stopped, so we
    // surface them verbatim and let the caller decide how to stop.
    return findContainersUsingPlatformData(ctx.projectId);
  },

  async apply(ctx, { dryRun }) {
    if (dryRun) return 'noop';

    const image = await resolveMigrationImage();
    const pending = await findPending(ctx.projectId, image);
    if (pending.length === 0) return 'noop';

    // Defensive: any platform/convex container that's still running at this
    // point holds open file handles against the volume we're about to copy.
    // The runner should have stopped them, but verify.
    for (const name of await findContainersUsingPlatformData(ctx.projectId)) {
      const inspect = await docker(
        'inspect',
        '--format',
        '{{.State.Running}}',
        name,
      );
      if (inspect.success && inspect.stdout.trim() === 'true') {
        await stopContainerOrThrow(name);
      }
    }

    for (const p of pending) {
      logger.info(`  [${p.scope}] ${p.oldName} → ${p.newName}`);
      await copyVolumeWithVerify(p.oldName, p.newName, image);
    }

    logger.info(
      'Legacy platform-data volumes are preserved. After verifying the new convex service is healthy, reclaim disk with:',
    );
    for (const p of pending) {
      logger.info(`  docker volume rm ${p.oldName}`);
    }
    return 'applied';
  },
};
