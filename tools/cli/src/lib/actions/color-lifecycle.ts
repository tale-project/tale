import { getProjectId, type ReplicaCounts } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import type { DeploymentColor, RotatableService } from '../compose/types';
import { detachColorFromNetworks } from '../docker/detach-color';
import { dockerCompose } from '../docker/docker-compose';
import { exec } from '../docker/exec';
import { getContainerVersion } from '../docker/get-container-version';
import { listComposeContainers } from '../docker/list-service-containers';
import { removeContainer } from '../docker/remove-container';
import { stopContainer } from '../docker/stop-container';
import { waitForServiceHealthy } from '../docker/wait-for-service-healthy';
import { drainBackend, endDrainBackend } from './drain-backend';

/**
 * Bringing one deployment COLOUR up and retiring another — the mechanics
 * `tale deploy` and `tale rollback` share, so the two cannot drift on the
 * order that keeps a flip from dropping requests.
 *
 * A colour is the whole stateless application tier at one version. Both
 * colours answer the same `platform` / `backend-api` aliases while they
 * overlap, which is safe in this order and no other:
 *
 *   1. the idle colour comes up — a replica that is still booting is not
 *      listening, so the resolver falls through to the live colour;
 *   2. every replica reports healthy;
 *   3. traffic is now split across both, which is the same forward-compatible
 *      window a rolling migration already assumes;
 *   4. the old colour is told to stop accepting NEW work and its in-flight
 *      work is waited out;
 *   5. only THEN is it cut out of DNS — `docker network disconnect` severs
 *      live connections, so doing it earlier would drop exactly the requests
 *      the drain exists to protect;
 *   6. and only then stopped.
 */

/** The compose project one colour's containers live in. */
export function colorProject(color: DeploymentColor): string {
  return `${getProjectId()}-${color}`;
}

/**
 * The platform image version a colour is running, read off any ONE of its
 * replicas: a colour is a single version by construction, so the first
 * replica answers for all of them. `null` when the colour is not up.
 */
export async function colorPlatformVersion(
  color: DeploymentColor,
): Promise<string | null> {
  const platforms = await listComposeContainers(
    colorProject(color),
    'platform',
  );
  const first = platforms[0];
  return first === undefined ? null : await getContainerVersion(first.name);
}

/** The colour-rolled services that carry a serving DNS alias. The worker has
 *  none — it is reached only through the job queue. */
const ALIASED_SERVICES: readonly RotatableService[] = [
  'platform',
  'backend-api',
];

/** Networks a colour serves on. The api is dual-homed; the web tier is not,
 *  and a disconnect from a network it never joined is a no-op. */
function servingNetworks(): string[] {
  return [`${getProjectId()}_internal`, 'tale-sandbox-net'];
}

/** `docker compose up` scale flags for the roles being deployed. */
function scaleArgs(
  services: readonly RotatableService[],
  replicas: ReplicaCounts,
): string[] {
  return services.flatMap((service) => [
    '--scale',
    `${service}=${replicas[service]}`,
  ]);
}

/**
 * Stop and remove every container compose created for a project. Used both
 * to clear a half-started colour from a previous failed deploy and to tear
 * the old colour down after a flip. Never throws: at teardown time the
 * traffic has already moved, and failing here would leave the deploy looking
 * broken when it is not.
 */
export async function removeColorContainers(
  projectName: string,
): Promise<number> {
  let removed = 0;
  for (const container of await listComposeContainers(projectName)) {
    const stopped = await stopContainer(container.name);
    if (!stopped) {
      logger.warn(`Failed to stop ${container.name}, continuing...`);
    }
    if (await removeContainer(container.name)) {
      removed += 1;
    } else {
      logger.warn(`Failed to remove ${container.name}, continuing...`);
    }
  }
  return removed;
}

export interface StartColorArgs {
  color: DeploymentColor;
  services: readonly RotatableService[];
  compose: string;
  replicas: ReplicaCounts;
  cwd: string;
  healthTimeout: number;
  forceRecreate?: boolean;
  streamLogs?: boolean;
}

/**
 * Bring a colour up and wait for EVERY replica of every role to be healthy.
 * Throws if compose fails or any replica never becomes healthy — the caller
 * then tears the half-colour down without having switched traffic to it.
 */
export async function startColor(args: StartColorArgs): Promise<void> {
  const project = colorProject(args.color);

  // Clear any containers a previous failed deploy left in this project.
  // Without it `up -d` silently restarts them, possibly on the old image,
  // and reports success.
  await removeColorContainers(project);

  logger.step(`Starting ${args.color} services...`);
  const result = await dockerCompose(
    args.compose,
    [
      'up',
      '-d',
      ...(args.forceRecreate === true ? ['--force-recreate'] : []),
      ...scaleArgs(args.services, args.replicas),
      ...args.services,
    ],
    { projectName: project, cwd: args.cwd },
  );
  if (!result.success) {
    logger.error(`Failed to deploy ${args.color} services`);
    logger.error(result.stderr);
    throw new Error('Color deployment failed');
  }

  logger.step('Waiting for services to be healthy...');
  for (const service of args.services) {
    const healthy = await waitForServiceHealthy(project, service, {
      timeout: args.healthTimeout,
      expectedReplicas: args.replicas[service],
      ...(args.streamLogs === undefined ? {} : { streamLogs: args.streamLogs }),
    });
    if (!healthy) {
      throw new Error(`Service ${service} (${args.color}) failed health check`);
    }
  }
}

export interface RetireColorArgs {
  color: DeploymentColor;
  /** Seconds to let the web tier finish in-flight requests after it starts
   *  refusing health checks. */
  drainTimeout: number;
  dryRun?: boolean;
}

/**
 * Retire the colour that was serving: stop it taking new work, wait for what
 * it already has, cut it out of DNS, stop it.
 *
 * The worker replicas come down WITH the rest rather than first. Jobs are
 * at-least-once and a killed one retries, but an agent turn's job is what
 * heartbeats the `app.generations` row the api's drain is waiting on — kill
 * the worker first and the drain waits out its whole budget for a generation
 * nothing is advancing any more. The old worker therefore keeps consuming
 * for the drain window, which is bounded and governed by the same
 * forward-compatibility rule that lets the old api keep serving.
 */
export async function retireColor(args: RetireColorArgs): Promise<void> {
  const project = colorProject(args.color);

  if (args.dryRun === true) {
    logger.step(
      `[DRY-RUN] Would drain and retire the ${args.color} colour (${args.drainTimeout}s web drain)`,
    );
    return;
  }

  // The web tier has no drain door: its entrypoint watches for this marker
  // and starts failing `/api/health`, so the proxy ejects it while in-flight
  // requests finish. Best-effort — a failure just falls back to the graceful
  // stop below.
  for (const container of await listComposeContainers(project, 'platform')) {
    if (!container.running) continue;
    const marked = await exec('docker', [
      'exec',
      container.name,
      'touch',
      '/tmp/platform-shutting-down',
    ]);
    if (!marked.success) {
      logger.debug(
        `Could not pre-mark ${container.name} for shutdown (continuing): ${marked.stderr.trim()}`,
      );
    }
  }

  // Refuse new chat turns on THIS colour only, and wait for the ones already
  // running. The new colour is serving throughout and is not affected.
  await drainBackend({ dryRun: false, colour: args.color });

  logger.step(`Draining ${args.color} services (${args.drainTimeout}s)...`);
  await Bun.sleep(args.drainTimeout * 1000);

  // Now — and only now — take the colour out of the aliases. This severs
  // live connections on those networks, which is why it comes after both
  // drains rather than before them.
  const detached = await detachColorFromNetworks(
    project,
    ALIASED_SERVICES,
    servingNetworks(),
  );
  if (detached > 0) {
    logger.info(`Detached ${args.color} from the serving networks.`);
  }

  logger.step(`Stopping ${args.color} services...`);
  await removeColorContainers(project);

  // Clear the drain flag. It names the retired colour, so no live replica was
  // ever affected by it — but the NEXT deploy flips back to that colour name,
  // and a flag still naming it would make the freshly started colour refuse
  // chats. Best-effort: the flag's own expiry is the backstop.
  await endDrainBackend();
}
