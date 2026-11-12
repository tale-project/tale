// Instance state changes and the state reads beside them: start, a stop
// with its grace (and force), freeze and unfreeze, an instance's runtime
// state, and the project's resource usage against its limits.
//
// A freeze holds every process of the instance in the cgroup freezer; a
// snapshot set freezes its volume users, snapshots, then thaws, and sends the
// calls of each phase in parallel (sequential calls held the users 0.66-0.76
// s on ZFS).

import {
  parseInstanceState,
  parseProjectState,
  type IncusInstanceState,
  type IncusProjectState,
} from './api.ts';
import type { IncusClient } from './client.ts';

/** How long a state change may take beyond the grace it was given. */
const STATE_SLACK_MS = 60_000;

export async function startInstance(
  client: IncusClient,
  name: string,
  options: { waitMs?: number } = {},
): Promise<void> {
  await client.changeInstanceState(name, 'start', {
    waitMs: options.waitMs ?? STATE_SLACK_MS,
  });
}

/** Stops the instance. Without `force`, Incus asks it to shut down and waits
 * up to `timeoutSeconds` (-1: as long as it takes, which needs the caller's
 * own `waitMs`); a stop that does not finish in that time fails, and the
 * caller decides whether to force. `force` kills at once. */
export async function stopInstance(
  client: IncusClient,
  name: string,
  options: { timeoutSeconds: number; force?: boolean; waitMs?: number },
): Promise<void> {
  if (
    !Number.isInteger(options.timeoutSeconds) ||
    options.timeoutSeconds < -1
  ) {
    throw new Error(`Not a stop timeout: ${options.timeoutSeconds}`);
  }
  if (options.timeoutSeconds === -1 && options.waitMs === undefined) {
    throw new Error(
      'A stop without a timeout (-1) needs the wait it may take (waitMs)',
    );
  }
  await client.changeInstanceState(name, 'stop', {
    force: options.force === true,
    timeoutSeconds: options.timeoutSeconds,
    waitMs:
      options.waitMs ??
      Math.max(options.timeoutSeconds, 0) * 1000 + STATE_SLACK_MS,
  });
}

export async function freezeInstance(
  client: IncusClient,
  name: string,
  options: { waitMs?: number } = {},
): Promise<void> {
  await client.changeInstanceState(name, 'freeze', {
    waitMs: options.waitMs ?? STATE_SLACK_MS,
  });
}

export async function unfreezeInstance(
  client: IncusClient,
  name: string,
  options: { waitMs?: number } = {},
): Promise<void> {
  await client.changeInstanceState(name, 'unfreeze', {
    waitMs: options.waitMs ?? STATE_SLACK_MS,
  });
}

/** The instance's runtime state (`Running`, `Stopped`, `Frozen` …, and its
 * addresses while it runs). */
export async function getInstanceState(
  client: IncusClient,
  name: string,
): Promise<IncusInstanceState> {
  return parseInstanceState(
    await client.sync(
      'GET',
      `/1.0/instances/${encodeURIComponent(name)}/state`,
      { query: { project: client.project }, retry: true },
    ),
  );
}

/** What the project uses against its limits (`disk` included), for a space
 * check before a restore. */
export async function getProjectState(
  client: IncusClient,
  name = client.project,
): Promise<IncusProjectState> {
  return parseProjectState(
    await client.sync(
      'GET',
      `/1.0/projects/${encodeURIComponent(name)}/state`,
      { retry: true },
    ),
  );
}
