import { externalDepError } from '../../utils/fail';
import { getProjectId, type ReplicaCounts } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import {
  appTierOfPlatformRole,
  describeReplicas,
  THREE_WAY,
  type AppTier,
} from '../compose/app-tier';
import {
  ROTATABLE_SERVICES,
  type DeploymentColor,
  type RotatableService,
} from '../compose/types';
import type { listComposeContainers } from '../docker/list-service-containers';
import type { waitForHealthy } from '../docker/wait-for-healthy';
import { dockerRuntime } from '../runtime/docker/docker-runtime';
import type { StackRuntime } from '../runtime/types';
import type { FlipPending } from '../state/flip-pending';
import { drainBackend, endDrainBackend } from './drain-backend';

/**
 * Bringing one deployment COLOUR up and retiring another — the mechanics
 * `tale deploy` and `tale rollback` share, so the two cannot drift on the
 * order that keeps a flip from dropping requests.
 *
 * A colour is the whole stateless application tier at one version, in one
 * of the shapes compose/app-tier.ts names: one `platform` process that is the
 * whole application, `platform` with the job runners apart, or the three
 * services. Two colours need not share a shape. Both answer the same
 * `platform` / `backend-api` aliases while they overlap, whichever of their
 * services does, which is safe in this order and no other:
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
 *
 * A runtime whose withdrawal cuts nothing (Incus: a marker the switch's
 * admission probe reads, `StackRuntime.withdrawal`) withdraws the old colour
 * BEFORE step 4 instead: from then on no new request reaches it, so the
 * drain waits out work that nothing joins any more, and its open requests
 * and streams end only at the stop.
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

/**
 * The shape a colour was started in, read off its `platform`: the role that
 * container runs names it (`appTierOfPlatformRole`).
 *
 * A colour without a `platform` container has nothing to ask. One that still
 * has a `backend-api` is a colour of three services that lost its web tier,
 * the only shape with that service; any other says nothing, and reads null.
 * So does a `platform` in a role no shape starts it in.
 *
 * A `platform` that is there and cannot be read is not guessed around: a
 * caller that then took the shape of the image instead would start the whole
 * application in a container that is the web tier of three services.
 */
export async function colorTier(
  color: DeploymentColor,
  runtime: StackRuntime = dockerRuntime,
): Promise<AppTier | null> {
  const instances = await runtime.list({ stack: colorProject(color) });
  const platform = instances.find(
    (instance) => instance.service === 'platform',
  );
  if (platform === undefined)
    return instances.some((instance) => instance.service === 'backend-api')
      ? THREE_WAY
      : null;
  const info = await runtime.inspect(platform.name);
  if (info === null)
    throw externalDepError(
      `Could not read which services the ${color} colour runs: ${platform.name} did not answer an inspect. Nothing was changed.`,
    );
  return appTierOfPlatformRole(info.environment.TALE_ROLE);
}

/**
 * True when every requested role has at least `replicas[role]` running.
 *
 * With `shape`, the colour must also BE a colour of that shape: no container
 * of an application service the shape lacks, and `platform` in the shape's
 * role. A flip is resumed onto a colour that is already up without starting
 * it again, so one an earlier deploy started in another shape must not pass
 * for the one asked: its `platform` would run without the jobs, or beside a
 * backend this deploy never checked.
 */
export async function colorLooksUp(
  color: DeploymentColor,
  services: readonly RotatableService[],
  replicas: ReplicaCounts,
  runtime: StackRuntime = dockerRuntime,
  shape?: AppTier,
): Promise<boolean> {
  const project = colorProject(color);
  for (const service of services) {
    const running = (await runtime.list({ stack: project, service })).filter(
      (container) => container.running,
    );
    if (running.length < replicas[service]) return false;
  }
  if (shape === undefined) return true;
  const present = new Set(
    (await runtime.list({ stack: project })).map(
      (container) => container.service,
    ),
  );
  if (
    ROTATABLE_SERVICES.some(
      (service) => present.has(service) && !shape.services.includes(service),
    )
  )
    return false;
  return (await colorTier(color, runtime))?.shape === shape.shape;
}

/** One running replica of each service: what a colour that serves has at
 *  least, whatever counts a deploy asks for. */
const AT_LEAST_ONE: ReplicaCounts = {
  platform: 1,
  'backend-api': 1,
  'backend-worker': 1,
};

/** What a flip does with the colour it promotes, and what it then retires. */
export interface ColorFlip {
  /** The colour that takes the traffic. */
  promoting: DeploymentColor;
  /** The colour retired once it has; null on a first deploy. */
  retiring: DeploymentColor | null;
  /** This continues a flip an earlier run recorded and did not finish. */
  resumed: boolean;
  /**
   * What is left to do for `promoting`:
   * - `start`  bring it up afresh. It serves nothing, so whatever an earlier
   *            run left of it is removed first.
   * - `wait`   it is up as asked: wait for its replicas, then switch.
   * - `keep`   it already HOLDS the traffic: the earlier run recorded the
   *            switch and stopped before it retired the old colour. It is
   *            never started again, whatever this run asks for; its health
   *            is waited for and the old colour retired.
   */
  step: 'start' | 'wait' | 'keep';
  /** The services of `promoting` to wait on and to hold to the admitted
   *  image: the ones asked, or under `keep` the ones it runs. */
  services: readonly RotatableService[];
  /** How many replicas of each to wait for. */
  replicas: ReplicaCounts;
  /** Under `keep`: what the colour runs, where that differs from what this
   *  run asks for (`platform×1, backend-worker×2`); null where it is as
   *  asked. The next deploy applies the difference with a flip of its own. */
  runsInstead: string | null;
}

/**
 * Decide, once, what a flip onto the idle colour does: start it, wait for
 * it, or finish an interrupted flip around a colour that already serves.
 *
 * A crash mid-flip leaves a record (`pending`) and either the new colour up
 * with the switch not recorded, or the switch recorded with the old colour
 * still up. The first is resumed only onto a colour that is up AS ASKED NOW:
 * one left in another shape, or short of replicas, serves nothing yet and is
 * started again. The second is the delicate one. The promoting colour holds
 * the traffic, and the old one may already be cut out of the serving names,
 * so starting it again (which removes it first) would take the site down,
 * and would put whatever image this run admitted in place of the one that
 * serves without the check a resume makes. It is kept as it is, in the shape
 * and at the counts it has, and what this run asks for beyond that waits for
 * the next deploy. Only a colour that holds the traffic on record and serves
 * none of it (a service of its shape has no running replica) is started
 * again, since that takes nothing away.
 */
export async function planColorFlip(args: {
  pending: FlipPending | null;
  /** The colour recorded as live; null before a first deploy. */
  current: DeploymentColor | null;
  /** The colour a flip that resumes nothing promotes. */
  next: DeploymentColor;
  tier: AppTier;
  replicas: ReplicaCounts;
  runtime?: StackRuntime;
}): Promise<ColorFlip> {
  const runtime = args.runtime ?? dockerRuntime;
  const { pending, current, tier, replicas } = args;
  const asked = {
    services: tier.services,
    replicas,
    runsInstead: null,
  } as const;
  const upAsAsked = (color: DeploymentColor) =>
    colorLooksUp(color, tier.services, replicas, runtime, tier);

  if (pending !== null && current === pending.promoting) {
    const retiringUp =
      pending.retiring !== null &&
      (await runtime.list({ stack: colorProject(pending.retiring) })).some(
        (container) => container.running,
      );
    if (retiringUp) {
      const resumed = {
        promoting: pending.promoting,
        retiring: pending.retiring,
        resumed: true,
      } as const;
      const live = await colorTier(pending.promoting, runtime);
      if (
        live !== null &&
        (await colorLooksUp(
          pending.promoting,
          live.services,
          AT_LEAST_ONE,
          runtime,
        ))
      ) {
        const running: ReplicaCounts = { ...AT_LEAST_ONE };
        for (const service of live.services)
          running[service] = (
            await runtime.list({
              stack: colorProject(pending.promoting),
              service,
            })
          ).filter((container) => container.running).length;
        const runs = describeReplicas(live, running);
        return {
          ...resumed,
          step: 'keep',
          services: live.services,
          replicas: AT_LEAST_ONE,
          runsInstead: runs === describeReplicas(tier, replicas) ? null : runs,
        };
      }
      return { ...resumed, step: 'start', ...asked };
    }
    // The old colour is gone: that flip finished and left its record behind.
  } else if (pending !== null) {
    const up = await upAsAsked(pending.promoting);
    if (up)
      return {
        promoting: pending.promoting,
        retiring: pending.retiring,
        resumed: true,
        step: 'wait',
        ...asked,
      };
    if (pending.promoting === args.next)
      return {
        promoting: args.next,
        retiring: current,
        resumed: false,
        step: 'start',
        ...asked,
      };
  }
  return {
    promoting: args.next,
    retiring: current,
    resumed: false,
    step: (await upAsAsked(args.next)) ? 'wait' : 'start',
    ...asked,
  };
}

/** The colour-rolled services that carry a serving DNS alias, in a colour
 *  of any shape: one without a `backend-api` has no replica of it to
 *  withdraw, and its `platform` holds both names. The worker has none — it
 *  is reached only through the job queue. */
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
  // `platform` alias. The edge health-checks that hostname as ONE server — a
  // 503 from the old colour marks the whole site down. Traffic leaves this
  // colour when it is withdrawn below, not via a health probe.

  // A withdrawal that cuts nothing goes first: the switch stops sending the
  // colour new requests before the drain waits out the ones it has.
  if (runtime.withdrawal === 'marker') {
    await runtime.withdraw(project, ALIASED_SERVICES);
    logger.info(`Withdrew ${args.color} from the switch.`);
  }

  // Refuse new chat turns on THIS colour only, and wait for the ones already
  // running. The new colour is serving throughout and is not affected.
  await drainBackend({ dryRun: false, colour: args.color, runtime });

  logger.step(`Draining ${args.color} services (${args.drainTimeout}s)...`);
  await Bun.sleep(args.drainTimeout * 1000);

  // Now — and only now — take the colour out of the aliases. This severs
  // live connections, which is why it comes after both drains rather than
  // before them.
  if (runtime.withdrawal === 'disconnect') {
    const detached = await runtime.withdraw(project, ALIASED_SERVICES);
    if (detached > 0) {
      logger.info(`Detached ${args.color} from the serving networks.`);
    }
  }

  logger.step(`Stopping ${args.color} services...`);
  await removeColorContainers(project, runtime);

  // Clear the drain flag. It names the retired colour, so no live replica was
  // ever affected by it — but the NEXT deploy flips back to that colour name,
  // and a flag still naming it would make the freshly started colour refuse
  // chats. Best-effort: the flag's own expiry is the backstop.
  await endDrainBackend(runtime);
}
