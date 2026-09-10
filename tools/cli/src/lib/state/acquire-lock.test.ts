import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { acquireLock } from './acquire-lock';
import { getLockFilePath } from './get-lock-file-path';
import { releaseLock } from './release-lock';

/** A pid no process holds: far above any real pid_max default. */
const DEAD_PID = 2_000_000_000;

let deployDir: string;

beforeEach(async () => {
  deployDir = await mkdtemp(join(tmpdir(), 'tale-lock-'));
});

afterEach(async () => {
  await releaseLock(deployDir);
  await rm(deployDir, { recursive: true, force: true });
});

async function seedStaleLock(): Promise<string> {
  const lockPath = getLockFilePath(deployDir);
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({
      pid: DEAD_PID,
      startedAt: '2026-01-01T00:00:00.000Z',
      command: 'deploy',
    }),
  );
  return lockPath;
}

describe('acquireLock', () => {
  test('takes over a stale lock', async () => {
    const lockPath = await seedStaleLock();

    expect(await acquireLock(deployDir, 'backup')).toBe(true);

    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
      pid: number;
      command: string;
    };
    expect(lock.pid).toBe(process.pid);
    expect(lock.command).toBe('backup');
  });

  test('refuses while a live process holds the lock', async () => {
    const lockPath = getLockFilePath(deployDir);
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: '2026-01-01T00:00:00.000Z',
        command: 'deploy',
      }),
    );

    expect(await acquireLock(deployDir, 'backup')).toBe(false);
  });

  test('two callers racing over one stale lock: exactly one wins', async () => {
    // Diagnostic metadata cannot admit a second operation: one SQLite kernel
    // lock owns the full deployment even while stale metadata is replaced.
    await seedStaleLock();

    const results = await Promise.all([
      acquireLock(deployDir, 'deploy'),
      acquireLock(deployDir, 'backup'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
