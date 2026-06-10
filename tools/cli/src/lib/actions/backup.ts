import { getProjectId, type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { createSnapshot } from '../backup/create-snapshot';
import { resolveSnapshotPrefix } from '../backup/resolve-prefix';
import { rotateSnapshots } from '../backup/rotate-snapshots';
import { getContainerVersion } from '../docker/get-container-version';
import { getCurrentColor } from '../state/get-current-color';
import { withLock } from '../state/with-lock';

interface BackupOptions {
  env: DeploymentEnv;
}

/**
 * Manual snapshot trigger — the same snapshot `tale deploy`/`tale start`
 * take automatically before mutating steps, runnable on demand (e.g.
 * right before a restore drill or ahead of risky host maintenance).
 */
export async function backup(options: BackupOptions): Promise<void> {
  const { env } = options;

  await withLock(env.DEPLOY_DIR, 'backup', async () => {
    logger.header('Creating Volume Snapshot');

    const prefix = await resolveSnapshotPrefix();
    if (!prefix) {
      throw new Error(
        'No Tale data volumes found for this project — nothing to back up. ' +
          'Run `tale start` or `tale deploy` first.',
      );
    }
    logger.info(`Volume namespace: ${prefix}*`);

    // Best-effort platform version for the manifest: the prod color
    // container first, then the dev container name (`tale start` stacks
    // run an uncolored platform container).
    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    const platformVersion = currentColor
      ? await getContainerVersion(`${getProjectId()}-platform-${currentColor}`)
      : await getContainerVersion(`${getProjectId()}-platform`);

    await createSnapshot({ prefix, trigger: 'manual', platformVersion });
    await rotateSnapshots({ prefix });
  });
}
