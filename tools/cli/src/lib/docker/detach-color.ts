import * as logger from '../../utils/logger';
import { docker } from './docker';
import { listComposeContainers } from './list-service-containers';

/**
 * Cut a colour out of the deployment's DNS before stopping it.
 *
 * Both colours of `platform` and `backend-api` answer the same network alias
 * while they overlap, and Docker's resolver hands a caller whichever it
 * likes. That is exactly what makes the overlap safe on the way UP — a
 * replica that is still booting is not listening, so the dialler falls
 * through to one that is — but it means the old colour keeps taking new
 * requests right up to the moment it is stopped, and a request that lands on
 * a container mid-SIGTERM is a request the user sees fail.
 *
 * Disconnecting the old colour from the serving networks removes its
 * addresses from the alias, deterministically, in one operation per
 * container. What it does NOT do is wait: `docker network disconnect` severs
 * the live connections on that network. So this runs only AFTER the drain has
 * finished — after the api reports zero in-flight generations and the web
 * tier's drain window has elapsed — and immediately before the stop.
 *
 * Best-effort, per container: a colour that cannot be detached is still going
 * to be stopped a moment later, and failing the deploy at this point would
 * leave two colours live, which is worse than the brief window this closes.
 */
export async function detachColorFromNetworks(
  projectName: string,
  services: readonly string[],
  networks: readonly string[],
): Promise<number> {
  let detached = 0;
  for (const service of services) {
    for (const container of await listComposeContainers(projectName, service)) {
      if (!container.running) continue;
      for (const network of networks) {
        const result = await docker(
          'network',
          'disconnect',
          network,
          container.name,
        );
        if (result.success) {
          detached += 1;
          continue;
        }
        // Not on that network (the api is dual-homed, the web tier is not),
        // or already gone — neither is worth failing a deploy over.
        logger.debug(
          `Could not detach ${container.name} from ${network} (continuing): ${result.stderr.trim()}`,
        );
      }
    }
  }
  return detached;
}
