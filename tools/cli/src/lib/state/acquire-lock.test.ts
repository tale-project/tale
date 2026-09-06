import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

mock.module('../../utils/logger', () => ({
  debug: mock(),
  info: mock(),
  warn: mock(),
  error: mock(),
}));

const { acquireLock } = await import('./acquire-lock');
const { getLockFilePath } = await import('./get-lock-file-path');

/** A pid no process holds: far above any real pid_max default. */
const DEAD_PID = 2_000_000_000;

let deployDir: string;

beforeEach(async () => {
  deployDir = await mkdtemp(join(tmpdir(), 'tale-lock-'));
});

afterEach(async () => {
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
    // Both see the same stale lock. With unlink-then-create, the second
    // caller's unlink removed the FIRST caller's fresh lock and both
    // proceeded — two concurrent deploys on the same volumes. The atomic
    // rename hand-over lets only one through.
    await seedStaleLock();

    const results = await Promise.all([
      acquireLock(deployDir, 'deploy'),
      acquireLock(deployDir, 'backup'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
