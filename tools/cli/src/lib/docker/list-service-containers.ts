import { docker } from './docker';

/**
 * Addressing a deployment's containers by their COMPOSE LABELS instead of by
 * a name the CLI reconstructs.
 *
 * A pinned `container_name` and `docker compose --scale` are mutually
 * exclusive — two containers cannot share one name — so the tiers that scale
 * have no name to guess. Compose stamps every container it creates with its
 * project, its service and its replica index, and those labels are there
 * whether or not the service also pins a name. Addressing by label therefore
 * covers both the replica sets and every container from before this change,
 * which is what makes the first deploy across the upgrade able to find, and
 * tear down, the colour it is replacing.
 *
 * The project and service labels alone are NOT enough to prove Compose made a
 * container. `docker compose build` BAKES both into the image it produces, so
 * anything later started from that image with a plain `docker run` inherits
 * them — a throwaway `tale-db` for an integration run answers a
 * `project=tale,service=db` filter exactly like the real one. Killing what
 * this lister returns is how a colour is torn down, so a false positive here
 * is someone else's container stopped.
 *
 * `container-number` is the discriminator: never an image label, always
 * stamped at container creation. A one-off (`docker compose run`) has one too
 * but is not a replica of the service, so it is excluded by its own label.
 */

export interface ComposeContainer {
  /** The container's real Docker name. */
  name: string;
  /** Compose service it belongs to, e.g. `backend-api`. */
  service: string;
  /** Replica index within that service (1-based; 1 for an unscaled one). */
  index: number;
  /** Whether it is running right now (as opposed to created/exited). */
  running: boolean;
}

const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';
const NUMBER_LABEL = 'com.docker.compose.container-number';
const ONEOFF_LABEL = 'com.docker.compose.oneoff';

/**
 * `docker ps` filters that match only containers Compose created for a
 * project — project label AND a container-number. The number is never an
 * image label, so a `docker run` from a compose-built image is excluded.
 * Signal handlers use this argv shape because they cannot await the lister.
 */
export function composeCreatedContainerFilters(projectName: string): string[] {
  return [
    '--filter',
    `label=${PROJECT_LABEL}=${projectName}`,
    '--filter',
    `label=${NUMBER_LABEL}`,
  ];
}

/**
 * Every container Compose created for `projectName`, optionally narrowed to
 * one service, ordered by service then replica index so callers get a stable
 * sequence (`…-1` before `…-2`) rather than Docker's creation order.
 *
 * Includes stopped containers: teardown and status both need to see them.
 */
export async function listComposeContainers(
  projectName: string,
  service?: string,
): Promise<ComposeContainer[]> {
  const args = [
    'ps',
    '-a',
    '--filter',
    `label=${PROJECT_LABEL}=${projectName}`,
    ...(service === undefined
      ? []
      : ['--filter', `label=${SERVICE_LABEL}=${service}`]),
    '--format',
    `{{.Names}}\t{{.Label "${SERVICE_LABEL}"}}\t{{.Label "${NUMBER_LABEL}"}}\t{{.State}}\t{{.Label "${ONEOFF_LABEL}"}}`,
  ];
  const result = await docker(...args);
  if (!result.success || !result.stdout) return [];

  return (
    result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, svc, number, state, oneoff] = line.split('\t');
        return {
          name: name ?? '',
          service: svc ?? '',
          index: Number.parseInt(number ?? '', 10),
          running: state === 'running',
          oneoff: (oneoff ?? '').toLowerCase() === 'true',
        };
      })
      // A missing replica index means Compose did not create this container —
      // it inherited the project/service labels from the image it runs. A
      // one-off is Compose's, but it is not a replica of the service.
      .filter(
        (container) =>
          container.name !== '' &&
          Number.isInteger(container.index) &&
          !container.oneoff,
      )
      .map(({ oneoff: _oneoff, ...container }) => container)
      .sort((a, b) => a.service.localeCompare(b.service) || a.index - b.index)
  );
}

/** Just the names, running-only, in replica order. */
export async function listRunningServiceContainers(
  projectName: string,
  service: string,
): Promise<string[]> {
  return (await listComposeContainers(projectName, service))
    .filter((container) => container.running)
    .map((container) => container.name);
}
