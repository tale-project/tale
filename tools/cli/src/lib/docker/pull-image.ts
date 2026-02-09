import * as logger from '../../utils/logger';
import { docker } from './docker';

export async function pullImage(image: string): Promise<boolean> {
  logger.info(`Pulling image: ${image}`);
  try {
    const result = await docker('pull', image);
    if (!result.success) {
      logger.error(`Failed to pull image: ${image}`);
      logger.error(result.stderr);
      return false;
    }
    return true;
  } catch (err) {
    logger.error(`Failed to pull image: ${image}`);
    logger.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}
