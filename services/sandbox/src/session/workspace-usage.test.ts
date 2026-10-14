import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  largestWorkspaces,
  measureWorkspaces,
  WORKSPACE_SIZE_TTL_MS,
  WorkspaceUsageCache,
} from './workspace-usage.ts';

const MIB = 1024 * 1024;

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-workspace-usage-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A workspace dir holding `mib` MiB of incompressible bytes. */
async function workspace(path: string, mib: number): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'data.bin'), randomBytes(mib * MIB));
}

describe('largestWorkspaces', () => {
  test('names the largest workspaces with du, a session’s copies in both layouts together', async () => {
    await workspace(join(root, 'ses-big'), 8);
    await workspace(join(root, 'ses-split'), 3);
    await workspace(join(root, 'blue', 'ses-split'), 3);
    await workspace(join(root, 'ses-mid'), 4);
    await workspace(join(root, 'ses-small'), 1);
    // Not workspaces: the trash, a file.
    await workspace(join(root, '.trash', 'ses-gone.1'), 16);
    await writeFile(join(root, 'spawner.lock'), 'x');

    const usage = await largestWorkspaces(root);
    expect(usage.total).toBe(5);
    expect(usage.measured).toBe(5);
    expect(usage.largest.map((entry) => entry.sessionId)).toEqual([
      'big',
      'split',
      'mid',
    ]);
    expect(usage.largest[0]?.bytes).toBeGreaterThanOrEqual(8 * MIB);
    expect(usage.largest[1]?.bytes).toBeGreaterThanOrEqual(6 * MIB);
  });

  test('reports what du measured before its deadline', async () => {
    await mkdir(join(root, 'ses-first'));
    await mkdir(join(root, 'ses-second'));
    let deadline: AbortSignal | undefined;
    const usage = await largestWorkspaces(
      root,
      { timeoutMs: 20 },
      {
        du: async (paths, signal) => {
          deadline = signal;
          await new Promise((resolve) =>
            signal.addEventListener('abort', resolve, { once: true }),
          );
          return `2048\t${paths.find((path) => path.endsWith('ses-second'))}\n`;
        },
      },
    );
    expect(deadline?.aborted).toBe(true);
    expect(usage).toEqual({
      largest: [{ sessionId: 'second', bytes: 2048 * 1024 }],
      measured: 1,
      total: 2,
    });
  });

  test('an empty session root runs no du', async () => {
    let ran = false;
    const usage = await largestWorkspaces(
      root,
      {},
      {
        du: async () => {
          ran = true;
          return '';
        },
      },
    );
    expect(ran).toBe(false);
    expect(usage).toEqual({ largest: [], measured: 0, total: 0 });
  });
});

describe('measureWorkspaces', () => {
  test("measures the named sessions' workspaces with du, a session's copies in both layouts together", async () => {
    await workspace(join(root, 'ses-big'), 6);
    await workspace(join(root, 'ses-split'), 2);
    await workspace(join(root, 'blue', 'ses-split'), 2);
    await workspace(join(root, 'ses-other'), 4);
    const sizes = await measureWorkspaces(root, ['big', 'split', 'gone']);
    expect([...sizes.keys()]).toEqual(['big', 'split', 'gone']);
    expect(sizes.get('big')).toBeGreaterThanOrEqual(6 * MIB);
    expect(sizes.get('split')).toBeGreaterThanOrEqual(4 * MIB);
    // Named but holding no workspace: nothing to measure.
    expect(sizes.get('gone')).toBeNull();
    expect(sizes.has('other')).toBe(false);
  });

  test('a session du did not reach by its deadline, or reached only in part, reads null', async () => {
    await mkdir(join(root, 'ses-done'));
    await mkdir(join(root, 'ses-half'));
    await mkdir(join(root, 'blue', 'ses-half'), { recursive: true });
    await mkdir(join(root, 'ses-late'));
    const asked: string[][] = [];
    const sizes = await measureWorkspaces(
      root,
      ['done', 'half', 'late'],
      { timeoutMs: 20 },
      {
        du: async (paths, signal) => {
          asked.push(paths);
          await new Promise((resolve) =>
            signal.addEventListener('abort', resolve, { once: true }),
          );
          const done = paths.find((path) => path.endsWith('ses-done'));
          const half = paths.find((path) => path.endsWith('blue/ses-half'));
          return `8\t${done}\n16\t${half}\n`;
        },
      },
    );
    expect(asked[0]?.length).toBe(4);
    expect(Object.fromEntries(sizes)).toEqual({
      done: 8 * 1024,
      half: null,
      late: null,
    });
  });

  test('nothing named runs no du', async () => {
    await mkdir(join(root, 'ses-unnamed'));
    let ran = false;
    const sizes = await measureWorkspaces(
      root,
      ['missing'],
      {},
      {
        du: async () => {
          ran = true;
          return '';
        },
      },
    );
    expect(ran).toBe(false);
    expect(Object.fromEntries(sizes)).toEqual({ missing: null });
  });
});

describe('WorkspaceUsageCache', () => {
  /** A cache over a fake measurement that sizes each id at its length in
   * MiB, recording what each measurement was asked. */
  function cache(now: () => number, fail = () => false) {
    const asked: string[][] = [];
    const instance = new WorkspaceUsageCache(async (ids) => {
      asked.push([...ids]);
      if (fail()) throw new Error('du could not run');
      return new Map(ids.map((id) => [id, id.length * MIB]));
    }, now);
    return { instance, asked };
  }

  test('measures what it is asked, then answers from the measurement for ten minutes', async () => {
    let now = 1_000_000;
    const { instance, asked } = cache(() => now);
    expect(await instance.usage(['aa', 'bbb'])).toEqual([
      { sessionId: 'aa', bytes: 2 * MIB, measuredAtMs: 1_000_000 },
      { sessionId: 'bbb', bytes: 3 * MIB, measuredAtMs: 1_000_000 },
    ]);
    now += WORKSPACE_SIZE_TTL_MS - 1;
    await instance.usage(['aa', 'bbb']);
    expect(asked).toEqual([['aa', 'bbb']]);
    now += 1;
    expect(await instance.usage(['aa', 'cccc'])).toEqual([
      { sessionId: 'aa', bytes: 2 * MIB, measuredAtMs: now },
      { sessionId: 'cccc', bytes: 4 * MIB, measuredAtMs: now },
    ]);
    expect(asked[1]?.toSorted()).toEqual(['aa', 'cccc']);
  });

  test('measures at most fifty a read, the longest unmeasured first', async () => {
    let now = 1_000_000;
    const { instance, asked } = cache(() => now);
    const ids = Array.from({ length: 60 }, (_, index) => `ses${index}`);
    const first = await instance.usage(ids);
    expect(asked[0]).toHaveLength(50);
    const unmeasured = first.filter((entry) => entry.measuredAtMs === null);
    expect(unmeasured).toHaveLength(10);
    expect(unmeasured.every((entry) => entry.bytes === null)).toBe(true);
    now += 1_000;
    await instance.usage(ids);
    expect(asked[1]?.toSorted()).toEqual(
      unmeasured.map((entry) => entry.sessionId).toSorted(),
    );
    // Once all are stale, the oldest measured go first.
    now += WORKSPACE_SIZE_TTL_MS;
    await instance.usage(ids);
    expect(asked[2]).toHaveLength(50);
    expect(asked[2]?.slice(0, 50).toSorted()).toEqual(
      (asked[0] ?? []).toSorted(),
    );
  });

  test('a measurement that failed reads null and is not repeated before its time', async () => {
    let now = 1_000_000;
    let failing = true;
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { instance, asked } = cache(
        () => now,
        () => failing,
      );
      expect(await instance.usage(['aa'])).toEqual([
        { sessionId: 'aa', bytes: null, measuredAtMs: 1_000_000 },
      ]);
      failing = false;
      await instance.usage(['aa']);
      expect(asked).toHaveLength(1);
      now += WORKSPACE_SIZE_TTL_MS;
      expect((await instance.usage(['aa']))[0]?.bytes).toBe(2 * MIB);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('one measurement runs at a time; a read arriving meanwhile waits for it', async () => {
    const gate = Promise.withResolvers<void>();
    const asked: string[][] = [];
    const instance = new WorkspaceUsageCache(async (ids) => {
      asked.push([...ids]);
      await gate.promise;
      return new Map(ids.map((id) => [id, 1]));
    });
    const first = instance.usage(['a', 'b']);
    const second = instance.usage(['a', 'b']);
    await Promise.resolve();
    gate.resolve();
    expect((await first).map((entry) => entry.bytes)).toEqual([1, 1]);
    expect((await second).map((entry) => entry.bytes)).toEqual([1, 1]);
    expect(asked).toEqual([['a', 'b']]);
  });
});
