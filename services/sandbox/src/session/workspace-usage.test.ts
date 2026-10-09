import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { largestWorkspaces } from './workspace-usage.ts';

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
