import * as defaultLogger from '../../utils/logger';
import { docker as defaultDocker } from './docker';

/**
 * Pausing the writers of a volume for the duration of a read of it.
 *
 * Two lanes need exactly this and used to have it only once: the pre-deploy
 * snapshot (a live tar of a running Postgres data dir is not restorable) and
 * the config-volume migration (a `cp -a` that races the backend's own writes
 * copies a half-written config tree). The pause typically lasts seconds;
 * unpause is guaranteed, and a failure to unpause shouts, because a container
 * left paused is an outage.
 *
 * Unpausing does not undo everything a pause did. Docker stops a paused
 * container's health monitor and marks it `unhealthy`, and the status stays
 * `unhealthy` until the first probe after the unpause — one full health-check
 * interval later. Whatever reads health in that window sees an outage that is
 * not there: `docker compose up` refuses at once to start the dependants of a
 * service it reads as unhealthy, which failed the first attempt of every
 * deploy that took a snapshot. So a container that was healthy, or still
 * starting, before the pause is awaited until it reports healthy again.
 */

export interface VolumePauseDeps {
  docker: typeof defaultDocker;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  logger: Pick<typeof defaultLogger, 'info' | 'warn' | 'error'>;
}

function realDeps(): VolumePauseDeps {
  return {
    docker: defaultDocker,
    sleep: (milliseconds) => Bun.sleep(milliseconds),
    now: () => Date.now(),
    logger: defaultLogger,
  };
}

/** Docker's values for a health-check setting left at zero. */
const DOCKER_INTERVAL_MS = 30_000;
const DOCKER_TIMEOUT_MS = 30_000;
const DOCKER_RETRIES = 3;
/** Slack for starting each probe and for the poll granularity. */
const RECOVERY_GRACE_MS = 5_000;
const POLL_MS = 1_000;

/**
 * Only what the wait needs: never the environment, the check's command or
 * its output log, any of which can carry a secret. Go field names on purpose:
 * the CLI executes a template against its typed response, where `if` handles
 * a container without a health check, and only when that fails retries it
 * against the raw JSON, where the absent key is an error.
 */
const HEALTH_FORMAT =
  '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} ' +
  '{{with .Config.Healthcheck}}{{json .Interval}} {{json .Timeout}} {{json .Retries}}{{else}}0 0 0{{end}}';
const HEALTH_LINE =
  /^\/?([a-zA-Z0-9][a-zA-Z0-9_.-]*) (healthy|unhealthy|starting|none) (\d+) (\d+) (\d+)$/;
const HEALTH_STATUSES = ['healthy', 'unhealthy', 'starting'] as const;
type HealthStatus = (typeof HEALTH_STATUSES)[number];

interface VolumeUser {
  id: string;
  name: string;
  /** Health before the pause; `null` without a health check Docker runs. */
  health: HealthStatus | null;
  /**
   * How long Docker itself may take to call a freshly monitored container
   * unhealthy: `retries` probes, each up to interval + timeout. Awaiting a
   * recovery that long tolerates exactly what Docker would have tolerated had
   * the container never been paused.
   */
  recoveryMs: number;
}

/** A container's current health, or `null` when Docker cannot describe it. */
async function inspectHealth(
  deps: VolumePauseDeps,
  id: string,
): Promise<Omit<VolumeUser, 'id'> | null> {
  const result = await deps.docker(
    'container',
    'inspect',
    '--format',
    HEALTH_FORMAT,
    id,
  );
  const match = result.success ? HEALTH_LINE.exec(result.stdout.trim()) : null;
  if (!match) return null;
  const [, name, status, interval, timeout, retries] = match;
  const milliseconds = (nanoseconds: string, dockerDefault: number) =>
    Number(nanoseconds) > 0 ? Number(nanoseconds) / 1_000_000 : dockerDefault;
  return {
    name,
    health: HEALTH_STATUSES.find((value) => value === status) ?? null,
    recoveryMs:
      (Number(retries) > 0 ? Number(retries) : DOCKER_RETRIES) *
        (milliseconds(interval, DOCKER_INTERVAL_MS) +
          milliseconds(timeout, DOCKER_TIMEOUT_MS)) +
      RECOVERY_GRACE_MS,
  };
}

/** The running containers that mount `volumeName`: what a read of it pauses. */
export async function listContainersUsingVolume(
  volumeName: string,
  docker: VolumePauseDeps['docker'] = defaultDocker,
): Promise<string[]> {
  const result = await docker('ps', '-q', '--filter', `volume=${volumeName}`);
  if (!result.success) {
    throw new Error(
      `Failed to list containers using volume ${volumeName}: ${result.stderr}`,
    );
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function seconds(milliseconds: number): string {
  return `${Math.ceil(milliseconds / 1000)}s`;
}

/**
 * Poll until each container reports healthy or its recovery window passes.
 * Returns the ones that did not recover, with the health they last reported.
 */
async function awaitRecovery(
  deps: VolumePauseDeps,
  awaited: readonly VolumeUser[],
): Promise<{ user: VolumeUser; health: string }[]> {
  const longest = Math.max(...awaited.map((user) => user.recoveryMs));
  deps.logger.info(
    `  Waiting for ${awaited.map((user) => user.name).join(', ')} to report healthy again after the pause (up to ${seconds(longest)})...`,
  );
  const started = deps.now();
  const late: { user: VolumeUser; health: string }[] = [];
  let pending = [...awaited];
  while (pending.length > 0) {
    const next: VolumeUser[] = [];
    for (const user of pending) {
      const current = await inspectHealth(deps, user.id);
      if (current?.health === 'healthy') continue;
      if (deps.now() - started >= user.recoveryMs) {
        late.push({
          user,
          health: current ? (current.health ?? 'none') : 'unknown',
        });
      } else {
        next.push(user);
      }
    }
    pending = next;
    if (pending.length > 0) await deps.sleep(POLL_MS);
  }
  return late;
}

/**
 * Unpause, then await every container whose health the pause took away.
 * `enforce` turns a container that was healthy and has not recovered into an
 * error; without it (the read itself already failed) it is only reported.
 */
async function resume(
  deps: VolumePauseDeps,
  paused: readonly VolumeUser[],
  enforce: boolean,
): Promise<void> {
  const awaited: VolumeUser[] = [];
  for (const user of paused) {
    const result = await deps.docker('unpause', user.id);
    if (!result.success) {
      // Never throw from here (it would mask whatever the caller needs to
      // see) — but a still-paused container is an outage, so shout.
      deps.logger.error(
        `Failed to unpause container ${user.id}: ${result.stderr}`,
      );
      deps.logger.error(`  Run manually: docker unpause ${user.id}`);
      continue;
    }
    // A container that was already unhealthy lost nothing to the pause, and
    // one without a health check has no status to lose.
    if (user.health === 'healthy' || user.health === 'starting') {
      awaited.push(user);
    }
  }
  if (awaited.length === 0) return;

  const failures: string[] = [];
  for (const { user, health } of await awaitRecovery(deps, awaited)) {
    const summary = `Container ${user.name} did not report healthy again within ${seconds(user.recoveryMs)} of being unpaused (health: ${health}).`;
    // One that was still starting may simply need longer than its probes
    // allow; only a container the pause took from healthy fails the read.
    if (enforce && user.health === 'healthy') failures.push(summary);
    else deps.logger.warn(summary);
  }
  if (failures.length > 0) throw new Error(failures.join(' '));
}

/**
 * Run `work` with every running container that mounts any of `volumeNames`
 * paused. `work` receives how many were paused, so a caller can report it.
 *
 * A container that cannot be paused, or whose health Docker cannot describe,
 * fails the whole operation BEFORE any of the read happens — a partially
 * paused set would produce exactly the torn copy the pause exists to prevent,
 * and a recovery nobody can observe cannot be awaited.
 *
 * Resolves only once every container that was healthy before the pause
 * reports healthy again. One that does not within its recovery window rejects
 * the call with its name and health, even though `work` succeeded.
 */
export async function withVolumeContainersPaused<T>(
  volumeNames: readonly string[],
  work: (pausedCount: number) => Promise<T>,
  injected: Partial<VolumePauseDeps> = {},
): Promise<T> {
  const deps = { ...realDeps(), ...injected };
  const ids = new Set<string>();
  for (const volumeName of volumeNames) {
    for (const id of await listContainersUsingVolume(volumeName, deps.docker)) {
      ids.add(id);
    }
  }
  const users: VolumeUser[] = [];
  for (const id of ids) {
    const current = await inspectHealth(deps, id);
    if (!current) {
      throw new Error(
        `Failed to read the health of container ${id} before pausing it for ${volumeNames.join(', ')}.`,
      );
    }
    users.push({ id, ...current });
  }

  const paused: VolumeUser[] = [];
  let value: T;
  try {
    for (const user of users) {
      const result = await deps.docker('pause', user.id);
      if (!result.success) {
        throw new Error(
          `Failed to pause container ${user.id} before reading ${volumeNames.join(', ')}: ${result.stderr}`,
        );
      }
      paused.push(user);
    }
    value = await work(paused.length);
  } catch (error) {
    // The caller must see why the read failed. The containers are still
    // unpaused and awaited, but nothing that happens doing so may replace
    // that error.
    await resume(deps, paused, false).catch((cleanup: unknown) => {
      deps.logger.error(
        `Restoring the paused containers failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
      );
    });
    throw error;
  }
  await resume(deps, paused, true);
  return value;
}
