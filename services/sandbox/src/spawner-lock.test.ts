// The spawner's host lock (cleanup.ts): a restart of the same container, or
// its recreation after a crash, takes the lock its dead predecessor left at
// once instead of restart-looping until it ages out; a live peer still keeps
// it. The identity and the process and container probes are the test's own.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireSpawnerLock,
  isLockHolderAlive,
  releaseSpawnerLock,
  type SpawnerLockIdentity,
  type SpawnerLockProbes,
} from './cleanup.ts';
import type { SpawnerConfig } from './types.ts';

const BOOT = '9b1c0d6e-0000-4000-8000-000000000001';
const CONTAINER = 'a1b2c3d4e5f6';

let root = '';
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-spawner-lock-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const cfg = (): SpawnerConfig =>
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  ({ hostSessionRoot: root }) as SpawnerConfig;

/** This spawner: PID 1 of its container, as in the shipped image. */
const self = (overrides: Partial<SpawnerLockIdentity> = {}) => ({
  pid: 1,
  hostname: CONTAINER,
  instanceId: 'self-instance',
  bootId: BOOT,
  startTicks: 5_000,
  ...overrides,
});

/** Probes over a fixed view of the machine: the live pids with their start
 * ticks, and the containers Docker knows with whether each runs. */
function machine(
  pids: Record<number, number>,
  containers: Record<string, boolean>,
): SpawnerLockProbes & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    processAlive: (pid) => pid in pids,
    startTicks: (pid) => pids[pid],
    async containerRunning(id) {
      asked.push(id);
      return id in containers ? (containers[id] ?? null) : 'missing';
    },
  };
}

async function writeLock(payload: object): Promise<void> {
  const path = join(root, '.spawner.lock');
  await writeFile(path, JSON.stringify(payload));
  // Just refreshed: well inside the freshness window.
  const now = Date.now() / 1000;
  await utimes(path, now, now);
}

/** Take the lock as `identity`; the refusal, or null and what was written. */
async function acquire(
  identity: SpawnerLockIdentity,
  probes: SpawnerLockProbes,
): Promise<{ refused: string | null; lock: Record<string, unknown> }> {
  let refused: string | null = null;
  try {
    await acquireSpawnerLock(cfg(), { self: identity, probes });
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  const lock: Record<string, unknown> = JSON.parse(
    await readFile(join(root, '.spawner.lock'), 'utf8'),
  );
  // Stops the refresh timer an acquire started (and removes the file).
  if (refused === null) await releaseSpawnerLock(cfg());
  return { refused, lock };
}

describe('the spawner lock after a crash', () => {
  test('a restarted container takes the lock its own earlier PID 1 left', async () => {
    // OOM-killed at its memory limit; Docker restarts the same container.
    await writeLock({
      pid: 1,
      hostname: CONTAINER,
      bootEpoch: Date.now() - 30_000,
      instanceId: 'crashed-instance',
      bootId: BOOT,
      startTicks: 4_000,
    });
    // PID 1 is alive: it is this process.
    const probes = machine({ 1: 5_000 }, { [CONTAINER]: true });
    const { refused, lock } = await acquire(self(), probes);
    expect(refused).toBeNull();
    expect(lock).toMatchObject({
      pid: 1,
      hostname: CONTAINER,
      instanceId: 'self-instance',
      bootId: BOOT,
      startTicks: 5_000,
    });
  });

  test('a lock from an earlier release, without a boot id, is reclaimed by the same container too', async () => {
    await writeLock({ pid: 1, hostname: CONTAINER, bootEpoch: 1 });
    expect(
      (await acquire(self(), machine({ 1: 5_000 }, {}))).refused,
    ).toBeNull();
  });

  test('a recreated container takes the lock of the container it replaced', async () => {
    const replaced = 'f6e5d4c3b2a1';
    // Removed by the recreate, or merely stopped.
    const variants: Array<Record<string, boolean>> = [
      { [CONTAINER]: true },
      { [CONTAINER]: true, [replaced]: false },
    ];
    for (const containers of variants) {
      await writeLock({
        pid: 1,
        hostname: replaced,
        bootEpoch: Date.now() - 30_000,
        instanceId: 'old-container',
        bootId: BOOT,
        startTicks: 4_000,
      });
      const probes = machine({ 1: 5_000 }, containers);
      const { refused, lock } = await acquire(self(), probes);
      expect(refused).toBeNull();
      expect(lock).toMatchObject({ hostname: CONTAINER });
      expect(probes.asked).toEqual([CONTAINER, replaced]);
    }
  });

  test('the same machine rebooted, or the PID now names another process: stale', async () => {
    await writeLock({ pid: 7, hostname: CONTAINER, bootId: 'earlier-boot' });
    expect((await acquire(self(), machine({ 7: 1 }, {}))).refused).toBeNull();
    await writeLock({
      pid: 7,
      hostname: CONTAINER,
      bootId: BOOT,
      startTicks: 100,
    });
    expect((await acquire(self(), machine({ 7: 200 }, {}))).refused).toBeNull();
  });
});

describe('the spawner lock held by a live peer', () => {
  test('another live process on this host keeps it', async () => {
    await writeLock({
      pid: 42,
      hostname: CONTAINER,
      bootId: BOOT,
      startTicks: 3_000,
    });
    const { refused, lock } = await acquire(
      self(),
      machine({ 1: 5_000, 42: 3_000 }, {}),
    );
    expect(refused).toContain('Another spawner appears to be running');
    // Refused, so the peer's lock is untouched.
    expect(lock).toMatchObject({ pid: 42 });
  });

  test('a live container on this machine keeps it', async () => {
    const peer = '0123456789ab';
    await writeLock({ pid: 1, hostname: peer, bootId: BOOT, startTicks: 1 });
    const probes = machine({ 1: 5_000 }, { [CONTAINER]: true, [peer]: true });
    expect((await acquire(self(), probes)).refused).toContain(
      'Another spawner',
    );
    expect(probes.asked).toEqual([CONTAINER, peer]);
  });

  test('what cannot be judged keeps it: another machine, a daemon that cannot say, an unreadable lock', async () => {
    const peer = '0123456789ab';
    const cases: Array<[object | string, SpawnerLockProbes]> = [
      // Another machine sharing the session root: its boot id differs.
      [
        { pid: 1, hostname: peer, bootId: 'other-machine' },
        machine({ 1: 5_000 }, { [CONTAINER]: true }),
      ],
      // A daemon that does not see this container is not this machine's.
      [{ pid: 1, hostname: peer, bootId: BOOT }, machine({ 1: 5_000 }, {})],
      // The daemon cannot say.
      [
        { pid: 1, hostname: peer, bootId: BOOT },
        {
          ...machine({ 1: 5_000 }, {}),
          containerRunning: async () => null,
        },
      ],
      // A host name that is no container id.
      [
        { pid: 1, hostname: 'build-host', bootId: BOOT },
        machine({ 1: 5_000 }, { [CONTAINER]: true }),
      ],
      ['not json', machine({}, {})],
      [{ hostname: CONTAINER }, machine({}, {})],
    ];
    for (const [payload, probes] of cases) {
      expect(
        await isLockHolderAlive(
          typeof payload === 'string' ? payload : JSON.stringify(payload),
          self(),
          probes,
        ),
      ).toBe(true);
    }
  });

  test('a stale lock is taken whoever holds it', async () => {
    await writeLock({ pid: 42, hostname: CONTAINER, bootId: BOOT });
    const old = Date.now() / 1000 - 120;
    await utimes(join(root, '.spawner.lock'), old, old);
    expect((await acquire(self(), machine({ 42: 1 }, {}))).refused).toBeNull();
  });
});

describe.skipIf(process.platform !== 'linux')(
  'the spawner lock against the real /proc',
  () => {
    test('a live process is told from one that reused its pid, and a gone one is dead', async () => {
      const bootId = readFileSync(
        '/proc/sys/kernel/random/boot_id',
        'utf8',
      ).trim();
      const me = self({
        pid: process.pid,
        hostname: hostname(),
        bootId,
        startTicks: undefined,
      });
      const peer = Bun.spawn(['sleep', '30']);
      const lock = (startTicks?: number) =>
        JSON.stringify({
          pid: peer.pid,
          hostname: hostname(),
          bootId,
          startTicks,
        });
      try {
        expect(await isLockHolderAlive(lock(), me)).toBe(true);
        // Its start time read from /proc differs from the recorded one.
        expect(await isLockHolderAlive(lock(0), me)).toBe(false);
      } finally {
        peer.kill();
        await peer.exited;
      }
      expect(await isLockHolderAlive(lock(), me)).toBe(false);
    });
  },
);
