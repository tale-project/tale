import * as defaultLogger from '../../utils/logger';
import { docker as defaultDocker } from './docker';

function isManifestNotFound(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes('not found') || lower.includes('manifest unknown');
}

/**
 * Side-effecting dependencies, injectable so the unit test can pass fakes
 * instead of reaching for `mock.module`. Bun's `mock.module` is process-global
 * and is not reset between files, so mocking the shared `docker`/`logger`
 * modules here is order-fragile across the suite — it surfaced as Windows-only
 * failures once sibling test files shifted the file-evaluation order. Plain DI
 * keeps the test hermetic; production callers still invoke `pullImage(image)`.
 */
interface PullImageDeps {
  docker: typeof defaultDocker;
  logger: Pick<typeof defaultLogger, 'info' | 'error' | 'warn'>;
}

export async function pullImage(
  image: string,
  { docker, logger }: PullImageDeps = {
    docker: defaultDocker,
    logger: defaultLogger,
  },
): Promise<boolean> {
  logger.info(`Pulling image: ${image}`);
  try {
    const result = await docker('pull', image);
    if (!result.success) {
      logger.error(`Failed to pull image: ${image}`);
      if (isManifestNotFound(result.stderr)) {
        logger.warn(
          'If this is a recent release, the images may still be building. ' +
            'Wait a few minutes and try again.',
        );
      } else {
        logger.error(result.stderr);
      }
      return false;
    }
    return true;
  } catch (err) {
    logger.error(`Failed to pull image: ${image}`);
    logger.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}
