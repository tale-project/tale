// The Docker host backend: the boot live-restore check, and the periodic
// sweep's hourly legacy half. Without the daemon's live restore a dockerd
// restart stops every session container and the spawner; the spawner never
// changes the host's daemon configuration, so it warns once at boot instead.

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import {
  type dockerSweepOrphans,
  LEGACY_SWEEP_INTERVAL_MS,
} from '../../cleanup.ts';
import { loadConfig } from '../../config.ts';
import type { RunDockerResult, runDocker } from '../../spawn-util.ts';
import {
  checkLiveRestore,
  DockerBackend,
  LIVE_RESTORE_DOCS_URL,
  parseLiveRestore,
} from './docker-backend.ts';

function answer(stdout: string, exitCode = 0, stderr = ''): RunDockerResult {
  return {
    exitCode,
    stdout,
    stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

/** A `runDocker` that records its argv and answers `result`. */
function fakeRun(result: RunDockerResult): {
  run: typeof runDocker;
  calls: string[][];
} {
  const calls: string[][] = [];
  const run: typeof runDocker = (args) => {
    calls.push(args);
    return Promise.resolve(result);
  };
  return { run, calls };
}

let warn: { mockRestore(): void } | null = null;

function captureWarnings(): string[] {
  const lines: string[] = [];
  warn = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return lines;
}

afterEach(() => {
  warn?.mockRestore();
  warn = null;
});

describe('parseLiveRestore', () => {
  test('reads the setting and whether the node is in Swarm mode', () => {
    expect(
      parseLiveRestore(answer('{"liveRestore":true,"swarm":"inactive"}\n')),
    ).toEqual({ enabled: true, swarm: false });
    expect(
      parseLiveRestore(answer('{"liveRestore":false,"swarm":"active"}')),
    ).toEqual({ enabled: false, swarm: true });
    expect(
      parseLiveRestore(answer('{"liveRestore":false,"swarm":"locked"}')),
    ).toEqual({ enabled: false, swarm: true });
    expect(
      parseLiveRestore(answer('{"liveRestore":false,"swarm":""}')),
    ).toEqual({ enabled: false, swarm: false });
  });

  test('a failed call or an answer without the setting says nothing', () => {
    captureWarnings();
    expect(parseLiveRestore(answer('', 1, 'Cannot connect'))).toBeNull();
    expect(parseLiveRestore(answer('<no value>'))).toBeNull();
    expect(parseLiveRestore(answer('{"swarm":"inactive"}'))).toBeNull();
    expect(parseLiveRestore(answer('{"liveRestore":"false"}'))).toBeNull();
    expect(parseLiveRestore(answer('null'))).toBeNull();
  });
});

describe('checkLiveRestore', () => {
  test('asks the daemon once, with a bounded call', async () => {
    const lines = captureWarnings();
    const { run, calls } = fakeRun(
      answer('{"liveRestore":true,"swarm":"inactive"}'),
    );
    expect(await checkLiveRestore(run)).toEqual({
      enabled: true,
      swarm: false,
    });
    expect(calls).toEqual([
      [
        'info',
        '--format',
        '{"liveRestore":{{json .LiveRestoreEnabled}},"swarm":{{json .Swarm.LocalNodeState}}}',
      ],
    ]);
    // Live restore on: nothing to say.
    expect(lines).toEqual([]);
  });

  test('warns once, pointing to the docs, when live restore is off', async () => {
    const lines = captureWarnings();
    const { run } = fakeRun(answer('{"liveRestore":false,"swarm":"inactive"}'));
    expect(await checkLiveRestore(run)).toEqual({
      enabled: false,
      swarm: false,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('live restore is off');
    expect(lines[0]).toContain('"live-restore": true');
    expect(lines[0]).toContain(LIVE_RESTORE_DOCS_URL);
  });

  test('never tells a Swarm node to turn on what Swarm refuses', async () => {
    const lines = captureWarnings();
    const { run } = fakeRun(answer('{"liveRestore":false,"swarm":"active"}'));
    await checkLiveRestore(run);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Swarm node');
    expect(lines[0]).not.toContain('"live-restore": true');
    expect(lines[0]).toContain(LIVE_RESTORE_DOCS_URL);
  });

  test('a daemon that cannot say is logged and never fails the boot', async () => {
    const lines = captureWarnings();
    const { run } = fakeRun(answer('', 124, 'docker info timed out'));
    expect(await checkLiveRestore(run)).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('could not read');
    expect(lines[0]).toContain('docker info timed out');
  });
});

const oldToken = process.env.SANDBOX_TOKEN;
afterEach(() => {
  if (oldToken === undefined) delete process.env.SANDBOX_TOKEN;
  else process.env.SANDBOX_TOKEN = oldToken;
});

const SWEEP = { staleBeforeMs: 0, isLive: () => false };

test('the legacy one-shot sweep runs at the first tick after boot and then hourly; a failed one is retried at the next tick', async () => {
  process.env.SANDBOX_TOKEN = 'docker-backend-test';
  let now = 1_000_000;
  let probeAnswers = true;
  const sweep = mock<typeof dockerSweepOrphans>(
    async (_cfg, _stale, _isLive, options) => ({
      removed: 0,
      legacySwept: options?.legacy === true && probeAnswers,
    }),
  );
  const boot = mock(async () => {});
  const backend = new DockerBackend(loadConfig(), {
    boot,
    sweep,
    sweepPackageCaches: async () => 0,
    now: () => now,
  });
  await backend.init();
  expect(boot).toHaveBeenCalledTimes(1);
  const legacyRuns = () =>
    sweep.mock.calls.map(([, , , options]) => options?.legacy);

  // The boot sweep's listing reads an unanswered daemon as empty, so the
  // first tick lists once more; the five-minute ticks in the hour after it
  // skip the legacy half.
  now += 5 * 60_000;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns()).toEqual([true]);
  for (let tick = 0; tick < 11; tick += 1) {
    now += 5 * 60_000;
    await backend.sweepOrphans(SWEEP);
  }
  expect(legacyRuns()).toEqual([true, ...Array(11).fill(false)]);

  now += 5 * 60_000;
  probeAnswers = false;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(true);
  // Its `docker ps` failed: the next tick tries again.
  now += 5 * 60_000;
  probeAnswers = true;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(true);
  now += LEGACY_SWEEP_INTERVAL_MS - 1;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(false);
  now += 1;
  await backend.sweepOrphans(SWEEP);
  expect(legacyRuns().at(-1)).toBe(true);
});

test('a sweep tick counts the package caches the retention sweep removed', async () => {
  process.env.SANDBOX_TOKEN = 'docker-backend-test';
  const backend = new DockerBackend(loadConfig(), {
    boot: async () => {},
    sweep: async () => ({ removed: 2, legacySwept: true }),
    sweepPackageCaches: async () => 3,
  });
  expect(await backend.sweepOrphans(SWEEP)).toBe(5);
});
