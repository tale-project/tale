import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { createSnapshot } from '../backup/create-snapshot';
import { resolveSnapshotPrefix } from '../backup/resolve-prefix';
import { rotateSnapshots } from '../backup/rotate-snapshots';
import { selectRuntime } from '../runtime/select-runtime';
import type { StackRuntime } from '../runtime/types';
import { getCurrentColor } from '../state/get-current-color';
import { withLock } from '../state/with-lock';
import { colorPlatformVersion } from './color-lifecycle';

interface BackupOptions {
  env: DeploymentEnv;
  /** The runtime to snapshot on; selected from `tale.json` when absent. */
  runtime?: StackRuntime;
}

/**
 * Manual snapshot trigger — the same snapshot `tale deploy`/`tale dev`
 * take automatically before mutating steps, runnable on demand (e.g.
 * right before a restore drill or ahead of risky host maintenance).
 */
export async function backup(options: BackupOptions): Promise<void> {
  const { env } = options;
  const runtime = options.runtime ?? (await selectRuntime(env.DEPLOY_DIR));

  await withLock(env.DEPLOY_DIR, 'backup', async () => {
    logger.header('Creating Volume Snapshot');

    const prefix = await resolveSnapshotPrefix(runtime);
    if (!prefix) {
      throw new Error(
        'No Tale data volumes found for this project — nothing to back up. ' +
          'Run `tale dev` or `tale deploy` first.',
      );
    }
    logger.info(`Volume namespace: ${prefix}*`);

    // Best-effort platform version for the manifest: the live colour's
    // replicas first, then the dev container name (`tale dev` stacks run an
    // uncoloured platform container under a pinned name).
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    const platformVersion = currentColor
      ? await colorPlatformVersion(currentColor, runtime)
      : await runtime.version(`${getProjectId()}-platform`);

    await createSnapshot({
      prefix,
      trigger: 'manual',
      platformVersion,
      runtime,
    });
    await rotateSnapshots({ prefix, runtime });
  });
}
