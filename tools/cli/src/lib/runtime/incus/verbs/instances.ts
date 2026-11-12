import { IncusApiError } from '@tale/incus/api';
import {
  isIncusBusy,
  isIncusNameConflict,
  type IncusClient,
} from '@tale/incus/client';
import { execWithOutput } from '@tale/incus/exec';
import {
  freezeInstance,
  startInstance,
  stopInstance,
  unfreezeInstance,
} from '@tale/incus/state';

import { preconditionError } from '../../../../utils/fail';
import type { InstanceInfo, InstanceSummary } from '../../types';
import {
  assertCustody,
  custodyOf,
  instanceInfo,
  type ObservedInstance,
} from '../apply/readback';
import { splitWords, type InstanceSpec } from '../compile/translate';
import type { PlanKey } from '../plan/digest';
import { STACK_PROFILE } from './probe';

/**
 * The stack's instances on Incus: made stopped from their spec, started,
 * stopped within their grace, removed, frozen and thawed, and read back
 * (design 4.1).
 *
 * Two labels make a restart visible, which Incus counts nowhere:
 * - `user.tale.want` (R-09): `running` on every start, `stopped` on every
 *   stop the CLI asks for. An instance that is stopped while it is wanted
 *   running stopped by itself: `boot.autorestart` gave up after ten quick
 *   exits.
 * - `user.tale.started`: the state's `started_at` right after the CLI started
 *   it. Incus moves `started_at` when `boot.autorestart` starts the instance
 *   again, so a later `started_at` is a restart the CLI did not ask for —
 *   what Docker reports as `RestartCount > 0`.
 */

const WANT_LABEL = 'user.tale.want';
const STARTED_LABEL = 'user.tale.started';
const GRACE_LABEL = 'user.tale.grace';
const ROLE_LABEL = 'user.tale.role';
const WAIT_MS = 120_000;
/** Docker's stop grace when a service declares none. */
const DEFAULT_GRACE_SECONDS = 10;
/** Roles that are no replica of a service: one-shot helpers and the image
 * facts' probe instances. */
const ONE_OFF_ROLES = new Set(['helper', 'probe']);
/** Incus's zero time, for an instance that never started. */
const NEVER = /^0001-01-01T/;
const PID1_MAX_BYTES = 64 * 1024;

/** How long a stop may take before it is forced: seconds, or `forever` —
 * the instance's declared grace, and never forced. */
export type StopGrace = number | 'forever';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The stop grace an instance declares (`user.tale.grace`). */
export function declaredGrace(config: Readonly<Record<string, string>>) {
  const value = Number(config[GRACE_LABEL] ?? String(DEFAULT_GRACE_SECONDS));
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_GRACE_SECONDS;
}

/** How long a label write waits out another operation on the instance. */
const BUSY_WAIT_MS = 30_000;
const BUSY_PAUSE_MS = 500;

/**
 * Write `user.*` labels. Incus refuses any update while a start or stop runs
 * on the instance ("is busy running …"), which happens when a service exits
 * at once and Incus is stopping it, or `boot.autorestart` is starting it
 * again; the write waits that out.
 */
async function writeLabels(
  client: IncusClient,
  name: string,
  config: Record<string, string>,
  options: { busyWaitMs?: number; pauseMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (options.busyWaitMs ?? BUSY_WAIT_MS);
  for (;;) {
    try {
      await client.patchInstance(name, { config });
      return;
    } catch (error) {
      if (!isIncusBusy(error) || Date.now() >= deadline) throw error;
      await Bun.sleep(options.pauseMs ?? BUSY_PAUSE_MS);
    }
  }
}

/** When the instance last reached Running; null when it never has. */
export async function instanceStartedAt(
  client: IncusClient,
  name: string,
): Promise<string | null> {
  const state = await client.sync(
    'GET',
    `/1.0/instances/${encodeURIComponent(name)}/state`,
    { query: { project: client.project }, retry: true },
  );
  const value = isRecord(state) ? state.started_at : undefined;
  return typeof value === 'string' && value !== '' && !NEVER.test(value)
    ? value
    : null;
}

/** Make the instance from its spec, stopped. An instance of that name that
 * exists already is refused, whoever's it is. */
export async function createStackInstance(
  client: IncusClient,
  spec: InstanceSpec,
  options: { profiles?: readonly string[] } = {},
): Promise<void> {
  try {
    await client.createInstance(
      {
        name: spec.name,
        ephemeral: false,
        profiles: options.profiles ?? [STACK_PROFILE],
        config: spec.config,
        devices: spec.devices,
        source: { type: 'image', alias: spec.image },
        start: false,
      },
      WAIT_MS,
    );
  } catch (error) {
    if (
      isIncusNameConflict(error) ||
      (error instanceof IncusApiError && /already exists/i.test(error.message))
    )
      throw preconditionError(
        `An instance named ${spec.name} exists already in the project.`,
        'Converge the stack instead, or remove the instance first.',
      );
    throw error;
  }
}

/** Mark the instance wanted running, start it, and record when it started
 * (R-09). One that runs already is only marked. */
export async function startStackInstance(
  client: IncusClient,
  name: string,
): Promise<void> {
  const read = await client.getInstance(name);
  if (read === undefined)
    throw preconditionError(`There is no instance ${name} to start.`);
  if (read.instance.config[WANT_LABEL] !== 'running')
    await writeLabels(client, name, { [WANT_LABEL]: 'running' });
  if (read.instance.status !== 'Running') await startInstance(client, name);
  const started = await instanceStartedAt(client, name);
  if (started !== null)
    await writeLabels(client, name, { [STARTED_LABEL]: started });
}

/**
 * Mark the instance stopped by the CLI (R-09) and stop it. With seconds, a
 * stop that does not finish in time is forced, with a warning. With
 * `forever`, it waits the instance's declared grace and is never forced: a
 * stop that does not finish fails and leaves the instance running.
 */
export async function stopStackInstance(
  client: IncusClient,
  name: string,
  grace: StopGrace,
): Promise<void> {
  await writeLabels(client, name, { [WANT_LABEL]: 'stopped' });
  const read = await client.getInstance(name);
  if (read === undefined || read.instance.status === 'Stopped') return;
  if (grace === 'forever') {
    const seconds = declaredGrace(read.instance.config);
    try {
      await stopInstance(client, name, { timeoutSeconds: seconds });
    } catch (error) {
      if (!(error instanceof IncusApiError)) throw error;
      throw preconditionError(
        `${name} did not stop within its declared ${seconds} s and is left running.`,
        `Stop it again, or force it: incus stop --force ${name}`,
      );
    }
    return;
  }
  try {
    await stopInstance(client, name, { timeoutSeconds: grace });
  } catch (error) {
    // A stop Incus refused or could not finish in time; anything else (the
    // connection, a cancellation) is no reason to force.
    if (!(error instanceof IncusApiError)) throw error;
    console.warn(
      `${name} did not stop within ${grace} s; forcing it:`,
      error.message,
    );
    await stopInstance(client, name, { timeoutSeconds: 0, force: true });
  }
}

/** Remove one of the stack's instances, stopping it within its declared
 * grace first. One that is gone counts as removed; one of another stack is
 * refused. */
export async function removeStackInstance(
  client: IncusClient,
  stack: string,
  name: string,
): Promise<boolean> {
  const read = await client.getInstance(name);
  if (read === undefined) return true;
  assertCustody(
    'instance',
    name,
    custodyOf(read.instance.config, stack),
    stack,
  );
  if (read.instance.status !== 'Stopped')
    await stopStackInstance(client, name, declaredGrace(read.instance.config));
  await client.deleteInstance(name, WAIT_MS);
  return true;
}

/** Freeze every instance named, in parallel (R3-16). */
export async function freezeStackInstances(
  client: IncusClient,
  names: readonly string[],
): Promise<void> {
  await Promise.all(names.map((name) => freezeInstance(client, name)));
}

/** Thaw every instance named, in parallel; each is tried even when another
 * fails, and the first failure is thrown after. */
export async function thawStackInstances(
  client: IncusClient,
  names: readonly string[],
): Promise<void> {
  const results = await Promise.allSettled(
    names.map((name) => unfreezeInstance(client, name)),
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed !== undefined) throw failed.reason;
}

function observed(
  instance: Awaited<ReturnType<IncusClient['getInstance']>>,
  stack: string,
): ObservedInstance | undefined {
  if (instance === undefined) return undefined;
  return {
    name: instance.instance.name,
    revision: instance.etag ?? null,
    status: instance.instance.status,
    running: instance.instance.status === 'Running',
    config: instance.instance.config,
    devices: instance.instance.devices,
    profiles: instance.instance.profiles,
    createdAt: instance.instance.createdAt,
    custody: custodyOf(instance.instance.config, stack),
  };
}

/**
 * The full readback of one instance; null when there is none. `restarted`
 * is true once Incus started it again after the CLI did; `startedAt` is
 * the last start, null while it never ran.
 */
export async function inspectStackInstance(
  client: IncusClient,
  name: string,
  key: PlanKey,
): Promise<InstanceInfo | null> {
  const read = observed(await client.getInstance(name), '');
  if (read === undefined) return null;
  const info = instanceInfo(read, key);
  const started = await instanceStartedAt(client, name);
  const recorded = read.config[STARTED_LABEL];
  const restarted =
    started !== null &&
    recorded !== undefined &&
    recorded !== '' &&
    Date.parse(started) > Date.parse(recorded);
  return {
    ...info,
    oneOff: ONE_OFF_ROLES.has(read.config[ROLE_LABEL] ?? ''),
    startedAt: started,
    restarted,
  };
}

/** Every replica of `stack` (one service's, when named), ordered by
 * service then index, stopped ones included and one-offs left out. */
export async function listStackInstances(
  client: IncusClient,
  filter: { stack: string; service?: string },
  key: PlanKey,
): Promise<InstanceSummary[]> {
  const summaries: InstanceSummary[] = [];
  for (const instance of await client.listInstances()) {
    const config = instance.config;
    if (config['user.tale.stack'] !== filter.stack) continue;
    if (ONE_OFF_ROLES.has(config[ROLE_LABEL] ?? '')) continue;
    if (
      filter.service !== undefined &&
      config['user.tale.service'] !== filter.service
    )
      continue;
    const info = instanceInfo(
      {
        name: instance.name,
        revision: null,
        status: instance.status,
        running: instance.status === 'Running',
        config,
        devices: instance.devices,
        profiles: instance.profiles,
        createdAt: instance.createdAt,
        custody: custodyOf(config, filter.stack),
      },
      key,
    );
    const summary: InstanceSummary = {
      stack: info.stack,
      service: info.service,
      index: info.index,
      oneOff: false,
      name: info.name,
      running: info.running,
      state: info.state,
    };
    if (info.colour !== undefined) summary.colour = info.colour;
    summaries.push(summary);
  }
  return summaries.sort(
    (left, right) =>
      left.service.localeCompare(right.service) || left.index - right.index,
  );
}

/** What PID 1 of a running instance is, read from `/proc/1/cmdline`. */
export interface Pid1Proof {
  argv: string[];
  /** Whether PID 1 runs exactly the instance's `oci.entrypoint`. Without
   * an `/init` of the image's own, Incus runs its lxc-init as PID 1
   * (`init`), which never matches. */
  matches: boolean;
}

/**
 * Prove what runs as PID 1 after a converge: exec `cat /proc/1/cmdline` and
 * compare it with the `oci.entrypoint` the CLI wrote — the patched `/init`
 * for every first-party image (D-21), so a stop signal reaches the service
 * as its own stop signal.
 */
export async function provePid1(
  client: IncusClient,
  name: string,
): Promise<Pid1Proof> {
  const read = await client.getInstance(name);
  if (read === undefined)
    throw preconditionError(`There is no instance ${name}.`);
  const output = await execWithOutput(
    client,
    name,
    ['cat', '/proc/1/cmdline'],
    {
      timeoutSeconds: 10,
      maxOutputBytes: PID1_MAX_BYTES,
    },
  );
  if (output.exitCode !== 0)
    throw new Error(
      `Reading PID 1 of ${name} exited ${output.exitCode}: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  const argv = new TextDecoder()
    .decode(output.stdout)
    .split('\0')
    .filter((word) => word !== '');
  const entrypoint = splitWords(read.instance.config['oci.entrypoint'] ?? '');
  return {
    argv,
    matches:
      entrypoint.length > 0 &&
      argv.length === entrypoint.length &&
      argv.every((word, index) => word === entrypoint[index]),
  };
}
