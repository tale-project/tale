import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  belowDiskFloor,
  diskReserveBytes,
  DockerDataRootMount,
  HostDiskProbe,
} from './host-disk.ts';

const GIB = 1024 ** 3;

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
      filesystem: '/sessions',
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

  test('protects both filesystems using their own reserve, without adding their capacity', async () => {
    let dockerFree = 15;
    const probe = new HostDiskProbe('/sessions', undefined, {
      additionalPath: () => Promise.resolve('/etc/hostname'),
      statfs: (path) =>
        Promise.resolve({
          bsize: GIB,
          blocks: path === '/sessions' ? 100 : 1000,
          bavail: path === '/sessions' ? 8 : dockerFree,
        }),
    });
    // Docker has MORE bytes free but less headroom against its 20 GiB floor.
    const short = await probe.read();
    expect(short).toEqual({
      totalBytes: 1000 * GIB,
      availableBytes: 15 * GIB,
      filesystem: '/etc/hostname',
    });
    expect(belowDiskFloor(short)).toBe(true);
    dockerFree = 30;
    expect(await probe.read(true)).toEqual({
      totalBytes: 100 * GIB,
      availableBytes: 8 * GIB,
      filesystem: '/sessions',
    });
    expect(belowDiskFloor(probe.latest())).toBe(false);
  });

  test('keeps workspace admission when Docker storage cannot be verified or read', async () => {
    for (const additional of [null, '/etc/hostname']) {
      const probe = new HostDiskProbe('/sessions', undefined, {
        additionalPath: () => Promise.resolve(additional),
        statfs: (path) =>
          path === '/sessions'
            ? Promise.resolve({ bsize: GIB, blocks: 100, bavail: 4 })
            : Promise.reject(new Error('unreadable Docker filesystem')),
      });
      expect(belowDiskFloor(await probe.read())).toBe(true);
    }
  });
});

describe('DockerDataRootMount', () => {
  const id = 'a'.repeat(64);
  const mountinfo = (root = `/var/lib/docker/containers/${id}/hostname`) =>
    `37 25 8:2 ${root} /etc/hostname rw,relatime - ext4 /dev/sda2 rw\n`;
  function fixture(
    options: {
      mounts?: string;
      dataRoot?: string;
      inspectId?: string;
      hostnamePath?: string;
    } = {},
  ) {
    const state = { now: 1000, fail: false, calls: [] as string[][] };
    const probe = new DockerDataRootMount({
      now: () => state.now,
      readFile: (path) => {
        expect(path).toBe('/proc/self/mountinfo');
        return Promise.resolve(options.mounts ?? mountinfo());
      },
      docker: (args) => {
        state.calls.push(args);
        const value =
          args[0] === 'info'
            ? (options.dataRoot ?? '/var/lib/docker')
            : {
                id: options.inspectId ?? id,
                hostnamePath:
                  options.hostnamePath ??
                  `/var/lib/docker/containers/${id}/hostname`,
              };
        return Promise.resolve({
          exitCode: state.fail ? 1 : 0,
          stdout: JSON.stringify(value),
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      },
    });
    return { state, probe };
  }

  test('verifies the existing hostname bind and shares/caches metadata reads', async () => {
    const { state, probe } = fixture();
    expect(await Promise.all([probe.read(), probe.read()])).toEqual([
      '/etc/hostname',
      '/etc/hostname',
    ]);
    expect(state.calls).toHaveLength(2);
    expect(state.calls.find((args) => args[0] === 'inspect')?.at(-1)).toBe(id);
    await probe.read();
    expect(state.calls).toHaveLength(2);
    state.now += 10 * 60_000;
    expect(await probe.read()).toBe('/etc/hostname');
    expect(state.calls).toHaveLength(4);
    expect(
      state.calls.every((args) => args[0] === 'info' || args[0] === 'inspect'),
    ).toBe(true);
  });

  test('recognizes data-root on a dedicated filesystem and escaped mount paths', async () => {
    expect(
      await fixture({
        mounts: mountinfo(`/containers/${id}/hostname`),
      }).probe.read(),
    ).toBe('/etc/hostname');
    expect(
      await fixture({
        mounts: mountinfo(`/my\\040docker/containers/${id}/hostname`),
        dataRoot: '/mnt/my docker',
        hostnamePath: `/mnt/my docker/containers/${id}/hostname`,
      }).probe.read(),
    ).toBe('/etc/hostname');
  });

  test.each([
    { mounts: '1 0 8:1 / / rw - ext4 /dev/sda1 rw\n' },
    { mounts: mountinfo('/custom/hostname') },
    { mounts: mountinfo() + mountinfo() },
    { inspectId: 'b'.repeat(64) },
    { hostnamePath: `/custom/containers/${id}/hostname` },
    { dataRoot: '/different-disk' },
  ])(
    'leaves mismatched or unverifiable storage unknown: %j',
    async (options) => {
      expect(await fixture(options).probe.read()).toBeNull();
    },
  );

  test('retries a failed daemon observation after 30 seconds without launching containers', async () => {
    const { state, probe } = fixture();
    state.fail = true;
    expect(await probe.read()).toBeNull();
    state.fail = false;
    expect(await probe.read()).toBeNull();
    expect(state.calls).toHaveLength(2);
    state.now += 30_000;
    expect(await probe.read()).toBe('/etc/hostname');
    expect(state.calls).toHaveLength(4);
  });

  test('keeps an unchanged verified mount during a daemon outage, but not a replacement', async () => {
    const options = { mounts: mountinfo() };
    const { state, probe } = fixture(options);
    expect(await probe.read()).toBe('/etc/hostname');
    state.now += 10 * 60_000;
    state.fail = true;
    expect(await probe.read()).toBe('/etc/hostname');
    expect(state.calls).toHaveLength(4);
    await probe.read();
    expect(state.calls).toHaveLength(4);
    state.now += 30_000;
    options.mounts = mountinfo().replace('37 25 8:2', '38 25 8:3');
    expect(await probe.read()).toBeNull();
    expect(state.calls).toHaveLength(6);
  });

  test('discards a previous verification when fresh daemon metadata contradicts it', async () => {
    const options = {
      hostnamePath: `/var/lib/docker/containers/${id}/hostname`,
    };
    const { state, probe } = fixture(options);
    expect(await probe.read()).toBe('/etc/hostname');
    state.now += 10 * 60_000;
    options.hostnamePath = '/custom/hostname';
    expect(await probe.read()).toBeNull();
    state.now += 30_000;
    state.fail = true;
    expect(await probe.read()).toBeNull();
  });
});
