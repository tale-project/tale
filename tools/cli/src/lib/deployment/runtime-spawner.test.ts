import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { rmSync } from 'node:fs';

import { ConfigurationDockerFixture } from './runtime-configuration-fixture';
import { drainSpawner, spawnerJson, spawnerStatus } from './runtime-spawner';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

// The runtime fixture commits a git repository; Windows CI runners stall on
// git for seconds at a time, and the 5 s default killed a passing test.
setDefaultTimeout(30_000);

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});
function create() {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  docker.installContainers(fixture.source);
  const configuration = new ConfigurationDockerFixture(docker);
  const containerId = configuration.sandbox().Id as string;
  const controls = () =>
    docker.calls
      .filter((call) => call.args.includes('/app/src/control-cli.ts'))
      .map((call) => call.args.at(-1));
  return { docker, configuration, containerId, controls };
}

describe('the spawner control calls of the managed runtime', () => {
  test('reads the exact status shape of the spawner', async () => {
    const { configuration, containerId } = create();
    configuration.sessions = ['session-one', 'session-two'];
    expect(
      await spawnerStatus(containerId, configuration.dependencies()),
    ).toEqual({
      draining: false,
      sessions: 2,
      sessionIds: ['session-one', 'session-two'],
    });
  });

  test.each([
    [
      'a count that differs from the ids',
      { draining: true, sessions: 2, sessionIds: ['a'] },
    ],
    ['an id twice', { draining: true, sessions: 2, sessionIds: ['a', 'a'] }],
    [
      'a field the spawner no longer answers',
      { draining: true, inFlight: 0, sessions: 0, sessionIds: [] },
    ],
    ['a missing field', { draining: true, sessions: 0 }],
    ['an empty id', { draining: true, sessions: 1, sessionIds: [''] }],
  ])('refuses a status with %s', async (_, status) => {
    const { configuration, containerId } = create();
    configuration.statusOverride = status;
    await expect(
      spawnerStatus(containerId, configuration.dependencies()),
    ).rejects.toThrow();
  });

  test('refuses an answer that is not JSON or is oversized', () => {
    expect(() => spawnerJson('not json')).toThrow('invalid JSON');
    expect(() => spawnerJson(' '.repeat(100_001))).toThrow('oversized');
    expect(spawnerJson('{"draining":true}')).toEqual({ draining: true });
  });

  test('latches the drain and reports a spawner that holds no session', async () => {
    const { configuration, containerId, controls } = create();
    expect(
      await drainSpawner(containerId, configuration.dependencies()),
    ).toEqual({ drained: true, sessions: 0 });
    expect(configuration.draining).toBe(true);
    expect(controls()).toEqual(['drain', 'drain-status']);
  });

  test('reads the status every five seconds up to sixty times while sessions remain, and stops none', async () => {
    const { configuration, containerId, controls } = create();
    configuration.sessions = ['session-preserved'];
    const sleeps: number[] = [];
    expect(
      await drainSpawner(containerId, {
        ...configuration.dependencies(),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).toEqual({ drained: false, sessions: 1 });
    expect(controls().filter((name) => name === 'drain')).toHaveLength(1);
    expect(controls().filter((name) => name === 'drain-status')).toHaveLength(
      60,
    );
    expect(sleeps).toHaveLength(59);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(5000);
    expect(configuration.sessions).toEqual(['session-preserved']);
    expect(configuration.restarted).toBe(0);
  });

  test('stops waiting as soon as the last session has ended', async () => {
    const { configuration, containerId, controls } = create();
    configuration.sessions = ['session-one', 'session-two'];
    let sleeps = 0;
    expect(
      await drainSpawner(containerId, {
        ...configuration.dependencies(),
        sleep: async () => {
          if (++sleeps === 2) configuration.sessions = [];
        },
      }),
    ).toEqual({ drained: true, sessions: 0 });
    expect(controls().filter((name) => name === 'drain-status')).toHaveLength(
      3,
    );
  });

  test('refuses a spawner that does not answer that its drain is latched', async () => {
    const { configuration, containerId } = create();
    const dependencies = configuration.dependencies();
    await expect(
      drainSpawner(containerId, {
        ...dependencies,
        exec: async (command, args, options) =>
          args.at(-1) === 'drain'
            ? {
                success: true,
                exitCode: 0,
                stderr: '',
                stdout: '{"draining":false}',
              }
            : dependencies.exec!(command, args, options),
      }),
    ).rejects.toThrow();
  });

  test('refuses a spawner that reads as not draining after the latch', async () => {
    const { configuration, containerId } = create();
    configuration.statusOverride = {
      draining: false,
      sessions: 0,
      sessionIds: [],
    };
    await expect(
      drainSpawner(containerId, configuration.dependencies()),
    ).rejects.toThrow('did not retain its drain latch');
  });
});
