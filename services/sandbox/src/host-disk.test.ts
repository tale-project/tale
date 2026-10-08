import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  belowDiskCritical,
  belowDiskFloor,
  diskCriticalBytes,
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

describe('diskCriticalBytes', () => {
  test('a quarter of the floor, at least 1 GiB and never above the floor', () => {
    // Floors of 2, 5 and 20 GiB.
    expect(diskCriticalBytes(20 * GIB)).toBe(GIB);
    expect(diskCriticalBytes(100 * GIB)).toBe(1.25 * GIB);
    expect(diskCriticalBytes(4096 * GIB)).toBe(5 * GIB);
    expect(diskCriticalBytes(100 * GIB, 40 * GIB)).toBe(10 * GIB);
    expect(diskCriticalBytes(100 * GIB, GIB / 2)).toBe(GIB / 2);
  });

  test('an operator’s tier stands as given, 0 turning it off; none while the floor is off', () => {
    expect(diskCriticalBytes(100 * GIB, undefined, 3 * GIB)).toBe(3 * GIB);
    expect(diskCriticalBytes(100 * GIB, undefined, 0)).toBe(0);
    expect(diskCriticalBytes(100 * GIB, 0)).toBe(0);
    expect(
      belowDiskCritical({ totalBytes: 100 * GIB, availableBytes: 0 }, 0),
    ).toBe(false);
    expect(
      belowDiskCritical(
        { totalBytes: 100 * GIB, availableBytes: 2 * GIB },
        undefined,
        3 * GIB,
      ),
    ).toBe(true);
  });

  test('an operator’s tier never stands above the floor, and a floor of 0 turns it off too', () => {
    // A 100 GiB disk keeps a 5 GiB floor unset.
    expect(diskCriticalBytes(100 * GIB, undefined, 8 * GIB)).toBe(5 * GIB);
    expect(diskCriticalBytes(100 * GIB, 4 * GIB, 8 * GIB)).toBe(4 * GIB);
    expect(diskCriticalBytes(100 * GIB, 0, 2 * GIB)).toBe(0);
    expect(
      belowDiskCritical(
        { totalBytes: 100 * GIB, availableBytes: GIB },
        0,
        2 * GIB,
      ),
    ).toBe(false);
  });

  test('an unknown or unreadable disk is never critical', () => {
    expect(belowDiskCritical(null)).toBe(false);
    expect(
      belowDiskCritical({
        totalBytes: 0,
        availableBytes: 0,
        unavailable: true,
      }),
    ).toBe(false);
    // Below the 5 GiB floor of a 100 GiB disk, above its 1.25 GiB tier.
    expect(
      belowDiskCritical({ totalBytes: 100 * GIB, availableBytes: 2 * GIB }),
    ).toBe(false);
    expect(
      belowDiskCritical({ totalBytes: 100 * GIB, availableBytes: GIB }),
    ).toBe(true);
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

  test('verifies the existing hostname bind once, sharing the read; while it stays mounted no Docker call follows', async () => {
    const { state, probe } = fixture();
    expect(await Promise.all([probe.read(), probe.read()])).toEqual([
      '/etc/hostname',
      '/etc/hostname',
    ]);
    expect(state.calls).toHaveLength(2);
    expect(state.calls.find((args) => args[0] === 'inspect')?.at(-1)).toBe(id);
    expect(
      state.calls.every((args) => args[0] === 'info' || args[0] === 'inspect'),
    ).toBe(true);
    for (const later of [60_000, 10 * 60_000, 24 * 60 * 60_000]) {
      state.now += later;
      expect(await probe.read()).toBe('/etc/hostname');
    }
    expect(state.calls).toHaveLength(2);
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

  test('keeps an unchanged verified mount during a daemon outage, but verifies a replacement', async () => {
    const options = { mounts: mountinfo() };
    const { state, probe } = fixture(options);
    expect(await probe.read()).toBe('/etc/hostname');
    state.now += 10 * 60_000;
    state.fail = true;
    expect(await probe.read()).toBe('/etc/hostname');
    expect(state.calls).toHaveLength(2);
    options.mounts = mountinfo().replace('37 25 8:2', '38 25 8:3');
    state.now += 60_000;
    expect(await probe.read()).toBeNull();
    expect(state.calls).toHaveLength(4);
  });

  test('a bind its reader reports unreadable is verified again, after the retry delay, and contradicting metadata discards it', async () => {
    const options = {
      hostnamePath: `/var/lib/docker/containers/${id}/hostname`,
    };
    const { state, probe } = fixture(options);
    expect(await probe.read()).toBe('/etc/hostname');
    probe.invalidate();
    expect(await probe.read()).toBeNull();
    expect(state.calls).toHaveLength(2);
    state.now += 30_000;
    options.hostnamePath = '/custom/hostname';
    expect(await probe.read()).toBeNull();
    expect(state.calls).toHaveLength(4);
  });

  test('a refuted verification backs off from 30 s, doubling to 10 min; an unanswered one is asked again after 30 s', async () => {
    const refuted = fixture({ dataRoot: '/different-disk' });
    const verifications = () => refuted.state.calls.length / 2;
    const gaps: number[] = [];
    let last = refuted.state.now;
    expect(await refuted.probe.read()).toBeNull();
    while (gaps.length < 7) {
      const before = verifications();
      refuted.state.now += 1_000;
      expect(await refuted.probe.read()).toBeNull();
      if (verifications() > before) {
        gaps.push(refuted.state.now - last);
        last = refuted.state.now;
      }
    }
    expect(gaps).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000,
    ]);

    const unanswered = fixture();
    unanswered.state.fail = true;
    expect(await unanswered.probe.read()).toBeNull();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      unanswered.state.now += 29_999;
      await unanswered.probe.read();
      expect(unanswered.state.calls).toHaveLength(2 * (attempt + 1));
      unanswered.state.now += 1;
      await unanswered.probe.read();
      expect(unanswered.state.calls).toHaveLength(2 * (attempt + 2));
    }
  });
});
