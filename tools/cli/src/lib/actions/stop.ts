/**
 * `tale stop` and `tale start`: the ordered, graceful stop and start of the
 * whole environment, on either runtime.
 *
 * The order is the stop groups the Incus runtime gives each instance as
 * `boot.stop.priority` (design D-23, R3-05), read from the one placement
 * table, so a `tale stop` and a host shutdown stop the stack alike:
 *
 * 1. the edge, the switch and both colours (90) — nothing new comes in,
 *    and the application tier hands its work on within its grace;
 * 2. the middle tier (50) — the sandbox, its egress and LLM gateway;
 * 3. data and the resolvers (10) — the database stops after every writer.
 *
 * Each group stops in parallel, each instance within its own declared grace
 * (Docker: `docker stop -t <grace>`, the compose file's `stop_grace_period`;
 * Incus: the instance's `user.tale.grace`), and the next group waits for it.
 * `tale start` runs the groups the other way round and waits for each to be
 * healthy before the next. On Incus it also marks every instance wanted
 * running again, which ends a stop after repeated crashes (R-09), and it
 * refuses while a restore is pending (R3-22).
 *
 * On a host that runs other projects beside Tale, a host shutdown stops
 * every project's groups one after another, so `tale stop` (ops' unit runs
 * it before the shutdown) is the supported way to stop Tale within its
 * graces (R3-28).
 */

import { getProjectId } from '../../utils/load-env';
import * as logger from '../../utils/logger';
import { buildColorCompose } from '../compose/generators/generate-color-compose';
import { buildStatefulCompose } from '../compose/generators/generate-stateful-compose';
import type { ComposeConfig } from '../compose/types';
import {
  assertNoRestorePending,
  readJournal,
} from '../runtime/incus/apply/journal';
import { placementOf, STOP_GROUPS } from '../runtime/incus/compile/placement';
import type { InstanceSummary, StackRuntime } from '../runtime/types';
import { withLock } from '../state/with-lock';

/** The stop groups, the first to stop first. */
const STOP_ORDER: readonly number[] = [
  STOP_GROUPS.edge,
  STOP_GROUPS.middle,
  STOP_GROUPS.data,
];

/** The stop group of a service; one the table does not know is middle. */
export function stopGroupOf(service: string): number {
  return placementOf(service)?.stop ?? STOP_GROUPS.middle;
}

function seconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)s$/.exec(value);
  return match === null ? undefined : Number(match[1]);
}

/**
 * The stop grace each service declares, in seconds, from the compose
 * documents the deploy generates (`stop_grace_period`): what Docker gives a
 * `docker stop -t`. A service that declares none is absent (Docker's own
 * 10 s applies).
 */
export function declaredGraces(): Record<string, number> {
  const config = { version: 'latest', registry: 'ghcr.io/tale-project/tale' };
  const documents: ComposeConfig[] = [
    buildStatefulCompose(config, 'localhost'),
    buildColorCompose(config, 'blue'),
  ];
  const graces: Record<string, number> = {};
  for (const document of documents)
    for (const [service, spec] of Object.entries(document.services ?? {})) {
      const grace = seconds(spec.stop_grace_period);
      if (grace !== undefined) graces[service] = grace;
    }
  return graces;
}

/** Every instance of the environment: the stack and both colours. */
async function environment(runtime: StackRuntime): Promise<InstanceSummary[]> {
  const project = getProjectId();
  const found: InstanceSummary[] = [];
  for (const stack of [project, `${project}-blue`, `${project}-green`])
    found.push(...(await runtime.list({ stack })));
  return found;
}

/** The instances grouped by stop group, in `order`. */
function grouped(
  instances: readonly InstanceSummary[],
  order: readonly number[],
): InstanceSummary[][] {
  return order
    .map((group) =>
      instances.filter((instance) => stopGroupOf(instance.service) === group),
    )
    .filter((group) => group.length > 0);
}

export interface StopOptions {
  deployDir: string;
  runtime: StackRuntime;
  dryRun?: boolean;
}

/** Stop the whole environment, group by group. Returns how many stopped. */
export async function stopEnvironment(options: StopOptions): Promise<number> {
  const { runtime } = options;
  return withLock(options.deployDir, 'stop', async () => {
    const prefix = options.dryRun ? '[DRY-RUN] ' : '';
    logger.header(`${prefix}Stopping the environment`);
    const graces = runtime.engine === 'docker' ? declaredGraces() : {};
    const running = (await environment(runtime)).filter(
      (instance) => instance.running,
    );
    let stopped = 0;
    for (const group of grouped(running, STOP_ORDER)) {
      logger.step(
        `${prefix}Stopping ${group.map((instance) => instance.name).join(', ')}...`,
      );
      if (options.dryRun) continue;
      const results = await Promise.all(
        group.map((instance) =>
          runtime.stop(instance.name, graces[instance.service]),
        ),
      );
      results.forEach((ok, index) => {
        if (ok) stopped += 1;
        else logger.warn(`Failed to stop ${group[index]?.name ?? ''}.`);
      });
    }
    if (running.length === 0) logger.info('Nothing is running.');
    else if (!options.dryRun) logger.success(`Stopped ${stopped} instance(s).`);
    return stopped;
  });
}

export interface StartOptions extends StopOptions {
  /** Seconds each instance may take to become healthy. */
  healthTimeout: number;
}

/** Start the whole environment, data first, each group healthy before the
 * next. Returns how many started. */
export async function startEnvironment(options: StartOptions): Promise<number> {
  const { runtime } = options;
  return withLock(options.deployDir, 'start', async () => {
    const prefix = options.dryRun ? '[DRY-RUN] ' : '';
    logger.header(`${prefix}Starting the environment`);
    if (runtime.engine === 'incus')
      assertNoRestorePending(await readJournal(options.deployDir), 'start');
    const stopped = (await environment(runtime)).filter(
      (instance) => !instance.running,
    );
    let started = 0;
    for (const group of grouped(stopped, [...STOP_ORDER].reverse())) {
      logger.step(
        `${prefix}Starting ${group.map((instance) => instance.name).join(', ')}...`,
      );
      if (options.dryRun) continue;
      const results = await Promise.all(
        group.map((instance) => runtime.start(instance.name)),
      );
      const up = group.filter((_, index) => results[index] === true);
      started += up.length;
      for (const instance of group)
        if (!up.includes(instance))
          logger.warn(`Failed to start ${instance.name}.`);
      for (const instance of up)
        if (
          !(await runtime.waitHealthy(instance.name, {
            timeout: options.healthTimeout,
          }))
        )
          throw new Error(`${instance.name} did not become healthy.`);
    }
    if (stopped.length === 0) logger.info('Nothing is stopped.');
    else if (!options.dryRun) logger.success(`Started ${started} instance(s).`);
    return started;
  });
}
