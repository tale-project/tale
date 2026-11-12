import { getProjectId, type ReplicaCounts } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import type { DeploymentColor, RotatableService } from '../compose/types';
import type { listComposeContainers } from '../docker/list-service-containers';
import type { waitForHealthy } from '../docker/wait-for-healthy';
import { dockerRuntime } from '../runtime/docker/docker-runtime';
import type { StackRuntime } from '../runtime/types';
import type { FlipPending } from '../state/flip-pending';
import { getCurrentColor } from '../state/get-current-color';
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
 *   5. only THEN is it withdrawn from the serving names — on Docker a
 *      `docker network disconnect`, which severs live connections, so doing
 *      it earlier would drop exactly the requests the drain exists to
 *      protect;
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
  runtime: StackRuntime = dockerRuntime,
): Promise<string | null> {
  const project = colorProject(color);
  // Current colour compose uses service `platform`. Pre-replica-set colour
  // compose used `platform-${color}` and `container_name: tale-platform-blue`.
  const platforms =
    (await runtime.list({ stack: project, service: 'platform' }))[0] ??
    (await runtime.list({ stack: project, service: `platform-${color}` }))[0];
  if (platforms !== undefined) {
    return runtime.version(platforms.name);
  }
  const pinned = await runtime.version(`${getProjectId()}-platform-${color}`);
  return pinned;
}

/** True when every requested role has at least `replicas[role]` running. */
export async function colorLooksUp(
  color: DeploymentColor,
  services: readonly RotatableService[],
  replicas: ReplicaCounts,
  runtime: StackRuntime = dockerRuntime,
): Promise<boolean> {
  const project = colorProject(color);
  for (const service of services) {
    const running = (await runtime.list({ stack: project, service })).filter(
      (container) => container.running,
    );
    if (running.length < replicas[service]) return false;
  }
  return true;
}

/**
 * A crash mid-flip left both colours up (or the new one up and the switch
 * not recorded). Resume that flip instead of `startColor` wiping the colour
 * that is already answering the alias.
 */
export async function isUnfinishedColorFlip(
  deployDir: string,
  pending: FlipPending,
  services: readonly RotatableService[],
  replicas: ReplicaCounts,
  runtime: StackRuntime = dockerRuntime,
): Promise<boolean> {
  const current = await getCurrentColor(deployDir);
  const promotingUp = await colorLooksUp(
    pending.promoting,
    services,
    replicas,
    runtime,
  );
  const retiringUp =
    pending.retiring !== null &&
    (await runtime.list({ stack: colorProject(pending.retiring) })).some(
      (container) => container.running,
    );

  if (current === pending.promoting && retiringUp) return true;
  if (current !== pending.promoting && promotingUp) return true;
  return false;
}

/** The colour-rolled services that carry a serving DNS alias. The worker has
 *  none — it is reached only through the job queue. */
const ALIASED_SERVICES: readonly RotatableService[] = [
  'platform',
  'backend-api',
];

/**
 * Stop and remove every container compose created for a project. Used both
 * to clear a half-started colour from a previous failed deploy and to tear
 * the old colour down after a flip. Never throws: at teardown time the
 * traffic has already moved, and failing here would leave the deploy looking
 * broken when it is not.
 *
 * The containers are stopped together, then removed: each one is given its
 * own stop grace (a backend worker's 120 s, while it hands its automation
 * runs on), so the teardown takes as long as the slowest of them rather than
 * the sum of every replica's.
 */
export async function removeColorContainers(
  projectName: string,
  runtime: StackRuntime = dockerRuntime,
): Promise<number> {
  const containers = await runtime.list({ stack: projectName });
  await Promise.all(
    containers.map(async (container) => {
      if (!(await runtime.stop(container.name))) {
        logger.warn(`Failed to stop ${container.name}, continuing...`);
      }
    }),
  );
  let removed = 0;
  for (const container of containers) {
    if (await runtime.remove(container.name)) {
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
  /** The runtime the command selected; Docker when not given. */
  runtime?: StackRuntime;
}

/**
 * Bring a colour up and wait for EVERY replica of every role to be healthy.
 * Throws if compose fails or any replica never becomes healthy — the caller
 * then tears the half-colour down without having switched traffic to it.
 */
export async function startColor(args: StartColorArgs): Promise<void> {
  const project = colorProject(args.color);
  const runtime = args.runtime ?? dockerRuntime;

  // Clear any containers a previous failed deploy left in this project.
  // Without it `up -d` silently restarts them, possibly on the old image,
  // and reports success.
  await removeColorContainers(project, runtime);

  logger.step(`Starting ${args.color} services...`);
  const result = await runtime.converge(
    { stack: project, compose: args.compose, cwd: args.cwd },
    {
      services: args.services,
      scale: args.replicas,
      forceRecreate: args.forceRecreate === true,
    },
  );
  if (!result.success) {
    logger.error(`Failed to deploy ${args.color} services`);
    logger.error(result.stderr);
    throw new Error('Color deployment failed');
  }

  await awaitColorHealthy(args, runtime);
}

/**
 * Wait until EVERY replica of every role in a colour is healthy, without
 * touching the colour. Throws when one is not, so traffic never moves onto
 * it.
 */
async function awaitColorHealthy(
  args: Pick<
    StartColorArgs,
    'color' | 'services' | 'replicas' | 'healthTimeout' | 'streamLogs'
  >,
  runtime: StackRuntime,
): Promise<void> {
  const project = colorProject(args.color);
  logger.step('Waiting for services to be healthy...');
  for (const service of args.services) {
    const healthy = await runtime.waitServiceHealthy(project, service, {
      timeout: args.healthTimeout,
      expectedReplicas: args.replicas[service],
      ...(args.streamLogs === undefined ? {} : { streamLogs: args.streamLogs }),
    });
    if (!healthy) {
      throw new Error(`Service ${service} (${args.color}) failed health check`);
    }
  }
}

/**
 * A flip resumed onto a colour that is already up (an earlier deploy timed out
 * waiting for it, perhaps while its first start was still migrating) takes
 * traffic only once each role has its replicas running and healthy. An exited
 * leftover replica does not count and is not waited on (the lister already
 * leaves out one-off containers). `deps` is injectable
 * for tests only.
 */
export async function awaitRunningColorHealthy(
  args: Pick<
    StartColorArgs,
    | 'color'
    | 'services'
    | 'replicas'
    | 'healthTimeout'
    | 'streamLogs'
    | 'runtime'
  >,
  deps: {
    list?: typeof listComposeContainers;
    wait?: typeof waitForHealthy;
  } = {},
): Promise<void> {
  const runtime = args.runtime ?? dockerRuntime;
  const list =
    deps.list ??
    ((stack: string, service?: string) =>
      runtime.list(service === undefined ? { stack } : { stack, service }));
  const wait =
    deps.wait ??
    ((name: string, options: { timeout: number; streamLogs?: boolean }) =>
      runtime.waitHealthy(name, options));
  const project = colorProject(args.color);
  logger.step(`Waiting for the ${args.color} services to be healthy...`);
  for (const service of args.services) {
    const running = (await list(project, service)).filter(
      (container) => container.running,
    );
    if (running.length < args.replicas[service])
      throw new Error(
        `Service ${service} (${args.color}) has ${running.length} of ${args.replicas[service]} replicas running`,
      );
    for (const container of running) {
      const healthy = await wait(container.name, {
        timeout: args.healthTimeout,
        ...(args.streamLogs === undefined
          ? {}
          : { streamLogs: args.streamLogs }),
      });
      if (!healthy)
        throw new Error(
          `Service ${service} (${args.color}) failed health check`,
        );
    }
  }
}

export interface RetireColorArgs {
  color: DeploymentColor;
  /** Seconds to let the web tier finish in-flight requests after it starts
   *  refusing health checks. */
  drainTimeout: number;
  dryRun?: boolean;
  /** The runtime the command selected; Docker when not given. */
  runtime?: StackRuntime;
}

/**
 * Retire the colour that was serving: stop it taking new work, wait for what
 * it already has, cut it out of DNS, stop it.
 *
 * The worker replicas come down WITH the rest rather than first. Already-
 * claimed long jobs (`retryLimit: 0`) finish on the old image; new claims
 * are deferred by the worker when its colour is draining. Web chat runs
 * in-process on the API and does not need the worker to heartbeat
 * `app.generations`.
 */
export async function retireColor(args: RetireColorArgs): Promise<void> {
  const project = colorProject(args.color);
  const runtime = args.runtime ?? dockerRuntime;

  if (args.dryRun === true) {
    logger.step(
      `[DRY-RUN] Would drain and retire the ${args.color} colour (${args.drainTimeout}s web drain)`,
    );
    return;
  }

  // Do NOT fail `/api/health` on the old platform while it still shares the
  // `platform` alias. Caddy health-checks that hostname as ONE upstream — a
  // 503 from the old colour marks the whole site down. Traffic leaves this
  // colour when it is withdrawn below, not via a health probe.

  // Refuse new chat turns on THIS colour only, and wait for the ones already
  // running. The new colour is serving throughout and is not affected.
  await drainBackend({ dryRun: false, colour: args.color, runtime });

  logger.step(`Draining ${args.color} services (${args.drainTimeout}s)...`);
  await Bun.sleep(args.drainTimeout * 1000);

  // Now — and only now — take the colour out of the aliases. This severs
  // live connections, which is why it comes after both drains rather than
  // before them.
  const detached = await runtime.withdraw(project, ALIASED_SERVICES);
  if (detached > 0) {
    logger.info(`Detached ${args.color} from the serving networks.`);
  }

  logger.step(`Stopping ${args.color} services...`);
  await removeColorContainers(project, runtime);

  // Clear the drain flag. It names the retired colour, so no live replica was
  // ever affected by it — but the NEXT deploy flips back to that colour name,
  // and a flag still naming it would make the freshly started colour refuse
  // chats. Best-effort: the flag's own expiry is the backstop.
  await endDrainBackend(runtime);
}
