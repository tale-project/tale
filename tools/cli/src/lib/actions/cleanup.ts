import { type DeploymentEnv } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { getCurrentColor } from '../state/get-current-color';
import { getOppositeColor } from '../state/get-opposite-color';
import { withLock } from '../state/with-lock';
import { colorProject, removeColorContainers } from './color-lifecycle';

interface CleanupOptions {
  env: DeploymentEnv;
}

/**
 * Remove the idle colour's containers.
 *
 * Addressed by compose PROJECT, not by reconstructed names: a colour is a
 * replica set, so what has to go is "everything compose created for that
 * colour" — however many replicas of however many roles that turned out to
 * be, including anything a half-finished deploy left behind.
 */
export async function cleanup(options: CleanupOptions): Promise<void> {
  const { env } = options;

  await withLock(env.DEPLOY_DIR, 'cleanup', async () => {
    logger.header('Cleaning Up Inactive Containers');

    const currentColor = await getCurrentColor(env.DEPLOY_DIR);
    if (!currentColor) {
      logger.info('No active deployment, nothing to clean up');
      return;
    }

    const inactiveColor = getOppositeColor(currentColor);
    logger.info(`Active color: ${currentColor}`);
    logger.info(`Cleaning up: ${inactiveColor}`);

    const cleaned = await removeColorContainers(colorProject(inactiveColor));

    if (cleaned > 0) {
      logger.success(`Cleaned up ${cleaned} inactive container(s)`);
    } else {
      logger.info('No inactive containers to clean up');
    }
  });
}
