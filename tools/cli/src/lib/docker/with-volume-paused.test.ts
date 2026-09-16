import { describe, expect, mock, test } from 'bun:test';

import type { ExecResult } from './exec';
import {
  type VolumePauseDeps,
  withVolumeContainersPaused,
} from './with-volume-paused';

/**
 * The regression this guards: Docker marks a paused container `unhealthy`
 * and unpausing leaves that status until the next probe, a full health-check
 * interval later. A deploy that snapshotted its volumes went straight on to
 * `docker compose up`, which refused at once because a dependency read
 * unhealthy — so every first attempt failed and every rerun (which skips the
 * snapshot) passed. The pause now restores the health it took away before it
 * lets the caller continue.
 */

const SECOND = 1_000_000_000;

type Health = 'healthy' | 'unhealthy' | 'starting' | null;

interface FakeContainer {
  name: string;
  health: Health;
  /** Health-check settings as Docker reports them: nanoseconds, 0 unset. */
  check?: { interval: number; timeout: number; retries: number };
  /** Inspections after the unpause that still read the stale status before
   *  a probe passes; `Infinity` never recovers. */
  staleReads?: number;
}

function probe(interval: number, timeout: number, retries: number) {
  return { interval: interval * SECOND, timeout: timeout * SECOND, retries };
}

function ok(stdout = ''): ExecResult {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

function failed(stderr: string): ExecResult {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

/**
 * Docker as the pause meets it: `pause` stops a container's health monitor
 * and marks it unhealthy, `unpause` keeps that status for `staleReads` more
 * inspections. Time moves only when the helper sleeps, so a recovery window
 * is measured exactly and never waited out.
 */
function fakeDocker(
  volumes: Record<string, string[]>,
  containers: Record<string, FakeContainer>,
  refuse: { pause?: string[]; unpause?: string[] } = {},
) {
  const calls: string[][] = [];
  const readsSinceUnpause = new Map<string, number>();
  let clock = 0;
  const docker: VolumePauseDeps['docker'] = async (...args) => {
    calls.push(args);
    const [command, subcommand] = args;
    const target = args.at(-1) ?? '';
    const container = containers[target];
    if (command === 'ps') {
      return ok((volumes[target.replace(/^volume=/, '')] ?? []).join('\n'));
    }
    if (command === 'pause' || command === 'unpause') {
      if (!container || refuse[command]?.includes(target)) {
        return failed(`cannot ${command} ${target}`);
      }
      if (command === 'unpause') readsSinceUnpause.set(target, 0);
      else if (container.health !== null) container.health = 'unhealthy';
      return ok();
    }
    if (command === 'container' && subcommand === 'inspect') {
      if (!container) return failed(`Error: No such container: ${target}`);
      const reads = readsSinceUnpause.get(target);
      if (reads !== undefined && container.health !== null) {
        readsSinceUnpause.set(target, reads + 1);
        if (reads >= (container.staleReads ?? 0)) container.health = 'healthy';
      }
      const check = container.check ?? probe(0, 0, 0);
      return ok(
        `/${container.name} ${container.health ?? 'none'} ${check.interval} ${check.timeout} ${check.retries}`,
      );
    }
    throw new Error(`Unexpected docker ${args.join(' ')}`);
  };
  const logger = { info: mock(), warn: mock(), error: mock() };
  const deps: VolumePauseDeps = {
    docker,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
    logger,
  };
  return {
    deps,
    logger,
    containers,
    elapsed: () => clock,
    /** Docker subcommands in call order, `container inspect` as `inspect`. */
    commands: () =>
      calls.map((args) => (args[0] === 'container' ? args[1] : args[0])),
  };
}

const archived = async () => 'archived';

describe('withVolumeContainersPaused', () => {
  test('awaits a container the pause marked unhealthy until it reports healthy again', async () => {
    const docker = fakeDocker(
      { 'p_db-data': ['db1'] },
      {
        db1: {
          name: 'p-db',
          health: 'healthy',
          check: probe(5, 10, 3),
          staleReads: 3,
        },
      },
    );
    const seenDuringWork: Health[] = [];

    const result = await withVolumeContainersPaused(
      ['p_db-data'],
      async (pausedCount) => {
        seenDuringWork.push(docker.containers.db1.health);
        return `archived with ${pausedCount} paused`;
      },
      docker.deps,
    );

    expect(result).toBe('archived with 1 paused');
    expect(seenDuringWork).toEqual(['unhealthy']);
    expect(docker.commands()).toEqual([
      'ps',
      'inspect',
      'pause',
      'unpause',
      'inspect',
      'inspect',
      'inspect',
      'inspect',
    ]);
    expect(docker.containers.db1.health).toBe('healthy');
    expect(docker.elapsed()).toBe(3_000);
    expect(docker.logger.info).toHaveBeenCalledWith(
      '  Waiting for p-db to report healthy again after the pause (up to 50s)...',
    );
  });

  // The window is `retries` probes of interval + timeout (+5 s): exactly as
  // long as Docker would take to call the container unhealthy on its own.
  test.each([
    ['its own health-check settings', probe(30, 10, 3), 125],
    ["Docker's defaults for unset settings", probe(0, 0, 0), 185],
  ])(
    'rejects with the container and its health once the recovery window from %s passes',
    async (_label, check, windowSeconds) => {
      const docker = fakeDocker(
        { 'p_caddy-data': ['proxy1'] },
        {
          proxy1: {
            name: 'p-proxy',
            health: 'healthy',
            check,
            staleReads: Infinity,
          },
        },
      );

      const error = await withVolumeContainersPaused(
        ['p_caddy-data'],
        archived,
        docker.deps,
      ).catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        message: `Container p-proxy did not report healthy again within ${windowSeconds}s of being unpaused (health: unhealthy).`,
      });
      expect(docker.elapsed()).toBe(windowSeconds * 1_000);
    },
  );

  test('does not wait for a container without a health check', async () => {
    const docker = fakeDocker(
      { 'p_config-data': ['worker1'] },
      { worker1: { name: 'p-backend-worker', health: null } },
    );

    expect(
      await withVolumeContainersPaused(
        ['p_config-data'],
        archived,
        docker.deps,
      ),
    ).toBe('archived');
    expect(docker.commands()).toEqual(['ps', 'inspect', 'pause', 'unpause']);
    expect(docker.elapsed()).toBe(0);
    expect(docker.logger.info).not.toHaveBeenCalled();
  });

  // A deploy may be the very fix for a sick container: blocking the snapshot
  // on a health the pause did not take away would refuse that deploy.
  test('does not wait for a container that was already unhealthy before the pause', async () => {
    const docker = fakeDocker(
      { 'p_db-data': ['db1'] },
      {
        db1: {
          name: 'p-db',
          health: 'unhealthy',
          check: probe(5, 10, 3),
          staleReads: Infinity,
        },
      },
    );

    expect(
      await withVolumeContainersPaused(['p_db-data'], archived, docker.deps),
    ).toBe('archived');
    expect(docker.commands()).toEqual(['ps', 'inspect', 'pause', 'unpause']);
    expect(docker.elapsed()).toBe(0);
  });

  test('awaits a container that was still starting, but only warns when it has not recovered in time', async () => {
    const docker = fakeDocker(
      { 'p_config-data': ['api1'] },
      {
        api1: {
          name: 'p-backend-api',
          health: 'starting',
          check: probe(10, 3, 3),
          staleReads: Infinity,
        },
      },
    );

    expect(
      await withVolumeContainersPaused(
        ['p_config-data'],
        archived,
        docker.deps,
      ),
    ).toBe('archived');
    expect(docker.elapsed()).toBe(44_000);
    expect(docker.logger.warn).toHaveBeenCalledWith(
      'Container p-backend-api did not report healthy again within 44s of being unpaused (health: unhealthy).',
    );
  });

  test('awaits every paused container of the read together, each on its own window', async () => {
    const docker = fakeDocker(
      {
        'p_convex-data': ['platform1'],
        'p_config-data': ['platform1', 'worker1', 'sandbox1'],
      },
      {
        platform1: {
          name: 'p-platform',
          health: 'healthy',
          check: probe(5, 3, 3),
          staleReads: 1,
        },
        worker1: { name: 'p-backend-worker', health: null },
        sandbox1: {
          name: 'p-sandbox',
          health: 'healthy',
          check: probe(10, 5, 3),
          staleReads: 2,
        },
      },
    );

    expect(
      await withVolumeContainersPaused(
        ['p_convex-data', 'p_config-data'],
        async (pausedCount) => pausedCount,
        docker.deps,
      ),
    ).toBe(3);
    expect(
      Object.values(docker.containers).map((container) => container.health),
    ).toEqual(['healthy', null, 'healthy']);
    expect(docker.elapsed()).toBe(2_000);
  });

  test('keeps the failure of the work itself, still restoring and reporting the paused containers', async () => {
    const docker = fakeDocker(
      { 'p_db-data': ['db1'] },
      {
        db1: {
          name: 'p-db',
          health: 'healthy',
          check: probe(5, 10, 3),
          staleReads: Infinity,
        },
      },
    );

    await expect(
      withVolumeContainersPaused(
        ['p_db-data'],
        async () => {
          throw new Error('disk full');
        },
        docker.deps,
      ),
    ).rejects.toThrow('disk full');
    expect(docker.commands()).toContain('unpause');
    expect(docker.elapsed()).toBe(50_000);
    expect(docker.logger.warn).toHaveBeenCalledWith(
      'Container p-db did not report healthy again within 50s of being unpaused (health: unhealthy).',
    );
  });

  test('fails before the read when a user cannot be paused, restoring the ones already paused', async () => {
    const docker = fakeDocker(
      { 'p_caddy-data': ['proxy1', 'other1'] },
      {
        proxy1: { name: 'p-proxy', health: 'healthy', check: probe(30, 10, 3) },
        other1: { name: 'p-other', health: null },
      },
      { pause: ['other1'] },
    );
    const work = mock(archived);

    await expect(
      withVolumeContainersPaused(['p_caddy-data'], work, docker.deps),
    ).rejects.toThrow(
      'Failed to pause container other1 before reading p_caddy-data',
    );
    expect(work).not.toHaveBeenCalled();
    expect(docker.commands()).toEqual([
      'ps',
      'inspect',
      'inspect',
      'pause',
      'pause',
      'unpause',
      'inspect',
    ]);
    expect(docker.containers.proxy1.health).toBe('healthy');
  });

  test("pauses nothing when Docker cannot describe a user's health", async () => {
    const docker = fakeDocker(
      { 'p_db-data': ['db1', 'gone1'] },
      { db1: { name: 'p-db', health: 'healthy' } },
    );
    const work = mock(archived);

    await expect(
      withVolumeContainersPaused(['p_db-data'], work, docker.deps),
    ).rejects.toThrow(
      'Failed to read the health of container gone1 before pausing it for p_db-data.',
    );
    expect(docker.commands()).not.toContain('pause');
    expect(work).not.toHaveBeenCalled();
  });

  test('does not await a container it could not unpause, and says how to recover', async () => {
    const docker = fakeDocker(
      { 'p_db-data': ['db1'] },
      { db1: { name: 'p-db', health: 'healthy', check: probe(5, 10, 3) } },
      { unpause: ['db1'] },
    );

    expect(
      await withVolumeContainersPaused(['p_db-data'], archived, docker.deps),
    ).toBe('archived');
    expect(docker.commands()).toEqual(['ps', 'inspect', 'pause', 'unpause']);
    expect(docker.logger.error).toHaveBeenCalledWith(
      '  Run manually: docker unpause db1',
    );
  });
});
