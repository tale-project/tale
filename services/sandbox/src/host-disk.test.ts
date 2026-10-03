import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  belowDiskFloor,
  diskReserveBytes,
  HostDiskProbe,
} from './host-disk.ts';

const GIB = 1024 ** 3;

test('the real Bun node:fs statfs source reads a disk without injection', async () => {
  const disk = await new HostDiskProbe(import.meta.dir).read(true);
  expect(disk).not.toBeNull();
  expect(disk?.totalBytes).toBeGreaterThan(0);
  expect(disk?.availableBytes).toBeGreaterThanOrEqual(0);
});

describe('diskReserveBytes', () => {
  test('keeps a twentieth of the disk free, at least 2 GiB and at most 20 GiB', () => {
    expect(diskReserveBytes(20 * GIB)).toBe(2 * GIB);
    expect(diskReserveBytes(100 * GIB)).toBe(5 * GIB);
    expect(diskReserveBytes(4096 * GIB)).toBe(20 * GIB);
  });

  test('an operator’s floor stands as given, 0 turning it off', () => {
    expect(diskReserveBytes(100 * GIB, 10 * GIB)).toBe(10 * GIB);
    expect(diskReserveBytes(100 * GIB, 0)).toBe(0);
    expect(
      belowDiskFloor({ totalBytes: 100 * GIB, availableBytes: 0 }, 0),
    ).toBe(false);
  });

  test('an unknown disk is never below its floor', () => {
    expect(belowDiskFloor(null)).toBe(false);
    expect(
      belowDiskFloor({ totalBytes: 100 * GIB, availableBytes: 4 * GIB }),
    ).toBe(true);
    expect(
      belowDiskFloor({ totalBytes: 100 * GIB, availableBytes: 6 * GIB }),
    ).toBe(false);
  });
});

describe('HostDiskProbe', () => {
  let logs: string[];
  const log = console.log;
  const warn = console.warn;
  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) =>
      void logs.push(args.map(String).join(' '));
    console.warn = (...args: unknown[]) =>
      void logs.push(args.map(String).join(' '));
  });
  afterEach(() => {
    console.log = log;
    console.warn = warn;
  });

  /** A disk of 100 GiB whose free space the test sets, counting reads. */
  function disk(freeGiB: number) {
    const state = { freeGiB, reads: 0, fails: false, now: 1_000 };
    const probe = new HostDiskProbe('/sessions', undefined, {
      statfs: (path) => {
        expect(path).toBe('/sessions');
        state.reads += 1;
        if (state.fails) return Promise.reject(new Error('EIO'));
        return Promise.resolve({
          bsize: 4096,
          blocks: (100 * GIB) / 4096,
          bavail: (state.freeGiB * GIB) / 4096,
        });
      },
      now: () => state.now,
    });
    return { state, probe };
  }

  test('reads the space an unprivileged process may still write, and reuses a recent reading', async () => {
    const { state, probe } = disk(30);
    expect(probe.latest()).toBeNull();
    expect(await probe.read()).toEqual({
      totalBytes: 100 * GIB,
      availableBytes: 30 * GIB,
    });
    state.freeGiB = 29;
    expect((await probe.read())?.availableBytes).toBe(30 * GIB);
    expect(state.reads).toBe(1);
    expect((await probe.read(true))?.availableBytes).toBe(29 * GIB);
    state.now += 5_000;
    state.freeGiB = 28;
    expect((await probe.read())?.availableBytes).toBe(28 * GIB);
    expect(probe.latest()?.availableBytes).toBe(28 * GIB);
  });

  test('a disk it cannot read is unknown, said once', async () => {
    const { state, probe } = disk(30);
    state.fails = true;
    expect(await probe.read(true)).toBeNull();
    expect(await probe.read(true)).toBeNull();
    expect(
      logs.filter((l) => l.includes('cannot read the free space')),
    ).toHaveLength(1);
    expect(probe.latest()).toBeNull();
  });

  test('says once when the disk goes below its floor, and once when it is back above', async () => {
    const { state, probe } = disk(30);
    await probe.read(true);
    expect(logs).toEqual([]);
    state.freeGiB = 4;
    await probe.read(true);
    await probe.read(true);
    state.freeGiB = 6;
    await probe.read(true);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain('has 4.0 GiB free, below its 5.0 GiB floor');
    expect(logs[1]).toContain('has 6.0 GiB free again');
  });
});
