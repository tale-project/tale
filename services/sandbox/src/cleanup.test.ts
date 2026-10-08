// Host-dir sweep layout safety. The invariant under test: the sweep removes
// ONLY genuinely expired legacy one-shot exec dirs and NEVER a session
// workspace — in the flat layout (`<root>/ses-<id>`) OR the legacy
// colour-rooted layout (`<root>/<colour>/ses-<id>`) that resolveWorkspaceDir
// still resumes from. A deleted live/stopped workspace is user data loss; an
// un-swept unknown dir is a small leak, so anything the sweep cannot classify
// is left alone.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DIND_VOLUME_MIN_AGE_MS,
  makeSweepTick,
  sweepHostSessionDirs,
  sweepOrphanDindVolumes,
} from './cleanup.ts';
import type { RunDockerResult } from './spawn-util.ts';

const OLD = new Date('2020-01-01T00:00:00Z');
// Everything older than "now minus one hour" counts as stale.
const threshold = () => Date.now() - 3_600_000;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-sweep-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Create a dir (with an optional marker file) under root. */
async function dir(rel: string, withFile = true): Promise<string> {
  const abs = join(root, rel);
  await mkdir(abs, { recursive: true });
  if (withFile) await writeFile(join(abs, 'data.txt'), rel);
  return abs;
}

/** Age paths to 2020. Parents LAST: creating a child bumps the parent mtime. */
async function age(...rels: string[]): Promise<void> {
  for (const rel of rels) await utimes(join(root, rel), OLD, OLD);
}

const exists = (rel: string) =>
  stat(join(root, rel)).then(
    () => true,
    () => false,
  );

describe('sweepHostSessionDirs', () => {
  test('never removes a flat session workspace, however old', async () => {
    await dir('ses-flat');
    await age('ses-flat');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(0);
    expect(await exists('ses-flat/data.txt')).toBe(true);
  });

  test('never removes a legacy colour-rooted session workspace or its root', async () => {
    await dir('blue/ses-legacy');
    await age('blue/ses-legacy', 'blue');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(0);
    expect(await exists('blue/ses-legacy/data.txt')).toBe(true);
  });

  test('removes stale one-shot dirs in both layouts, keeps the sessions beside them', async () => {
    await dir('stale-exec_1');
    await dir('blue/ses-legacy');
    await dir('blue/oldexec');
    await age('stale-exec_1', 'blue/ses-legacy', 'blue/oldexec', 'blue');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(2);
    expect(await exists('stale-exec_1')).toBe(false);
    expect(await exists('blue/oldexec')).toBe(false);
    expect(await exists('blue/ses-legacy/data.txt')).toBe(true);
  });

  test('removes an empty legacy root once its last session is gone', async () => {
    await dir('green', false);
    await age('green');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(1);
    expect(await exists('green')).toBe(false);
  });

  test('keeps fresh one-shot dirs and dirs still in flight', async () => {
    await dir('fresh-exec');
    await dir('live-exec');
    await age('live-exec');

    const removed = await sweepHostSessionDirs(
      root,
      threshold(),
      (id) => id === 'live-exec',
    );

    expect(removed).toBe(0);
    expect(await exists('fresh-exec/data.txt')).toBe(true);
    expect(await exists('live-exec/data.txt')).toBe(true);
  });

  test('leaves files and unclassifiable dirs alone', async () => {
    await writeFile(join(root, '.spawner.lock'), '{}');
    await dir('weird+name');
    await dir('.hidden');
    await dir('has spaces');
    await age('weird+name', '.hidden', 'has spaces', '.spawner.lock');

    const removed = await sweepHostSessionDirs(root, threshold());

    expect(removed).toBe(0);
    expect(await exists('.spawner.lock')).toBe(true);
    expect(await exists('weird+name/data.txt')).toBe(true);
    expect(await exists('.hidden/data.txt')).toBe(true);
    expect(await exists('has spaces/data.txt')).toBe(true);
  });

  test('a missing root is not an error', async () => {
    expect(await sweepHostSessionDirs(join(root, 'nope'), threshold())).toBe(0);
  });
});

// REGRESSION: the 5-min periodic sweep had no overlap guard — against a
// wedged daemon every tick stacked another sweep (and its docker children)
// on top of the still-running one.
describe('makeSweepTick', () => {
  test('a tick that overlaps a running sweep skips; the next one after it runs', async () => {
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tick = makeSweepTick(
      {
        async sweepOrphans() {
          calls += 1;
          if (calls === 1) await gate;
          return 0;
        },
      },
      { maxTimeoutMs: 1_000 },
    );
    const first = tick();
    await tick(); // overlaps → skipped
    expect(calls).toBe(1);
    release();
    await first;
    await tick();
    expect(calls).toBe(2);
  });

  test('a throwing sweep is logged and releases the guard', async () => {
    let calls = 0;
    const tick = makeSweepTick(
      {
        async sweepOrphans() {
          calls += 1;
          throw new Error('docker ps failed');
        },
      },
      { maxTimeoutMs: 1_000 },
    );
    await tick();
    await tick();
    expect(calls).toBe(2);
  });
});

function dockerResult(stdout: string, exitCode = 0): RunDockerResult {
  return {
    exitCode,
    stdout,
    stderr: exitCode === 0 ? '' : 'refused',
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

describe('sweepOrphanDindVolumes', () => {
  const NOW = Date.parse('2026-10-08T12:00:00Z');
  const iso = (ageMs: number) => new Date(NOW - ageMs).toISOString();

  test('lists only volumes no container references, and with none forks nothing more', async () => {
    const docker = mock(async (_args: string[]) => dockerResult(''));
    expect(await sweepOrphanDindVolumes(docker, () => NOW)).toBe(0);
    expect(docker.mock.calls.map(([args]) => args)).toEqual([
      [
        'volume',
        'ls',
        '-q',
        '--filter',
        'label=tale.sandbox-dind=1',
        '--filter',
        'dangling=true',
      ],
    ]);
  });

  test('removes orphans past the minimum age and leaves a create its fresh volume', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const created: Record<string, string> = {
      'tale-dind-old': iso(DIND_VOLUME_MIN_AGE_MS + 1_000),
      'tale-dind-fresh': iso(60_000),
      'tale-dind-undated': '',
    };
    const docker = mock(async (args: string[]) => {
      if (args[1] === 'ls') {
        return dockerResult(`${Object.keys(created).join('\n')}\n`);
      }
      if (args[1] === 'inspect') {
        // A volume removed since the listing fails the inspect, which still
        // prints the others.
        return dockerResult(
          args
            .slice(4)
            .map(
              (name) =>
                `${JSON.stringify(name)}\t${JSON.stringify(created[name])}`,
            )
            .join('\n'),
          1,
        );
      }
      return dockerResult('');
    });
    try {
      expect(await sweepOrphanDindVolumes(docker, () => NOW)).toBe(1);
    } finally {
      log.mockRestore();
    }
    const removals = docker.mock.calls
      .map(([args]) => args)
      .filter((args) => args[1] === 'rm');
    expect(removals).toEqual([['volume', 'rm', 'tale-dind-old']]);
  });

  test('a removal the daemon refuses is logged and not counted', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const docker = mock(async (args: string[]) => {
      if (args[1] === 'ls') return dockerResult('tale-dind-old\n');
      if (args[1] === 'inspect') {
        return dockerResult(
          `"tale-dind-old"\t${JSON.stringify(iso(DIND_VOLUME_MIN_AGE_MS * 2))}\n`,
        );
      }
      return dockerResult('', 1);
    });
    try {
      expect(await sweepOrphanDindVolumes(docker, () => NOW)).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
