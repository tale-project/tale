import * as logger from '../../utils/logger';
import { listComposeContainers } from './list-service-containers';
import { waitForHealthy } from './wait-for-healthy';

/**
 * Wait for EVERY replica of one compose service to become healthy.
 *
 * `waitForHealthy` answers about one container, which was enough while every
 * service was a singleton with a name the CLI could reconstruct. A replica
 * set has neither: the names come from compose, and "the service is up" means
 * all of them, not the first one that happens to answer. A deploy that
 * flipped after one replica of three came up would hand traffic to a colour
 * that is still two thirds unstarted.
 */
export async function waitForServiceHealthy(
  projectName: string,
  service: string,
  options: {
    timeout: number;
    /** How many replicas compose was asked for; fewer means it did not
     *  create them, which is a failure, not something to wait out. */
    expectedReplicas: number;
    streamLogs?: boolean;
  },
): Promise<boolean> {
  const containers = await listComposeContainers(projectName, service);
  if (containers.length < options.expectedReplicas) {
    logger.error(
      `Expected ${options.expectedReplicas} ${service} replica(s) in ${projectName}, found ${containers.length}`,
    );
    return false;
  }

  for (const container of containers) {
    const healthy = await waitForHealthy(container.name, {
      timeout: options.timeout,
      ...(options.streamLogs === undefined
        ? {}
        : { streamLogs: options.streamLogs }),
    });
    if (!healthy) return false;
  }
  return true;
}
