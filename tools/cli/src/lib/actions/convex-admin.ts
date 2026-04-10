import * as logger from '../../utils/logger';
import { docker } from '../docker/docker';
import { findPlatformContainer } from '../docker/find-platform-container';

export async function convexAdmin(): Promise<void> {
  logger.step('Detecting platform container...');

  const container = await findPlatformContainer();
  logger.info(`Using container: ${container}`);
  logger.blank();

  const result = await docker('exec', container, './generate-admin-key.sh');
  if (!result.success) {
    throw new Error(result.stderr || 'Failed to generate admin key');
  }

  console.log(result.stdout);
}
