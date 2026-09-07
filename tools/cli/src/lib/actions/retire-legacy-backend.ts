import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { listComposeContainers } from '../docker/list-service-containers';
import { removeContainer } from '../docker/remove-container';
import { stopContainer } from '../docker/stop-container';

/**
 * Remove the backend tier from where it USED to live.
 *
 * Before the application tier became a colour, `backend-api` and
 * `backend-worker` were stateful singletons in the deployment's own compose
 * project (`<id>`, pinned as `<id>-backend-api`). They are now part of each
 * colour's project (`<id>-blue` / `<id>-green`).
 *
 * That makes the FIRST deploy across the upgrade the dangerous one: the new
 * colour comes up with its own api replicas, the old colour is retired by
 * project label — and the pre-upgrade singletons, which belong to neither
 * colour, are simply never looked at. They would keep running on the old
 * image, keep answering the shared `backend-api` alias, and keep consuming
 * jobs from the same queue, indefinitely.
 *
 * So the flip sweeps them explicitly, and only once: on an already-migrated
 * deployment there is nothing under those labels and this is a no-op. It runs
 * AFTER the new colour is live, so the deployment is never without an api.
 *
 * Best-effort, like the rest of the teardown: traffic has already moved, and
 * failing the deploy here would report a broken upgrade that isn't one.
 */
export async function retireLegacyBackendTier(): Promise<number> {
  const project = getProjectId();
  let removed = 0;

  for (const service of ['backend-api', 'backend-worker'] as const) {
    for (const container of await listComposeContainers(project, service)) {
      logger.step(
        `Removing the pre-upgrade ${service} singleton (${container.name}) — the tier now runs inside each colour...`,
      );
      if (!(await stopContainer(container.name))) {
        logger.warn(`Failed to stop ${container.name}, continuing...`);
      }
      if (await removeContainer(container.name)) {
        removed += 1;
      } else {
        logger.warn(
          `Failed to remove ${container.name}; remove it by hand — left running it answers the backend-api alias on the old image.`,
        );
      }
    }
  }
  return removed;
}
