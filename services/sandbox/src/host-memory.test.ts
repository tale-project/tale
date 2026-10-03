import { describe, expect, test } from 'bun:test';

import {
  autoSessionCapacity,
  HostMemoryProbe,
  memoryReserveBytes,
  sessionWorkingSetBytes,
} from './host-memory.ts';

const GIB = 1024 ** 3;

describe('sizing from the host', () => {
  test.each([16, 17])(
    'rejects an impossible %s GiB reserve at boot sizing',
    (reserve) => {
      expect(() => autoSessionCapacity(16 * GIB, reserve * GIB)).toThrow(
        'SANDBOX_MIN_FREE_MEMORY',
      );
    },
  );
  test('the reserve is a tenth of the host, at least 1 GiB, unless configured', () => {
    expect(memoryReserveBytes(4 * GIB)).toBe(GIB);
    expect(memoryReserveBytes(64 * GIB)).toBe(Math.floor((64 * GIB) / 10));
    expect(memoryReserveBytes(64 * GIB, 2 * GIB)).toBe(2 * GIB);
  });

  test('capacity follows memory, never below the old default of 8 nor above 256', () => {
    const capacity = (gib: number) =>
      autoSessionCapacity(gib * GIB, memoryReserveBytes(gib * GIB));
    expect(capacity(4)).toBe(8);
    expect(capacity(16)).toBe(19);
    expect(capacity(64)).toBe(76);
    expect(capacity(1024)).toBe(256);
  });

  test('where agent sessions run their own Docker daemon, a slot holds a whole such turn', () => {
    const capacity = (gib: number) =>
      autoSessionCapacity(gib * GIB, memoryReserveBytes(gib * GIB), true);
    expect(capacity(4)).toBe(8);
    expect(capacity(16)).toBe(9);
    expect(capacity(64)).toBe(38);
  });

  test('a starting session is planned at its kind of working set', () => {
    expect(sessionWorkingSetBytes('default', true)).toBe(512 * 1024 ** 2);
    expect(sessionWorkingSetBytes('agent', false)).toBe(512 * 1024 ** 2);
    expect(sessionWorkingSetBytes('agent', true)).toBe(1536 * 1024 ** 2);
  });
});

describe('HostMemoryProbe', () => {
  const meminfo = (totalKb: number, availableKb: number) =>
    `MemTotal:       ${totalKb} kB\nMemFree:          1000 kB\nMemAvailable:   ${availableKb} kB\n`;

  function probe(scenario: {
    endpoint?: string;
    kernel?: string;
    daemonTotalBytes?: number;
    available?: () => number;
    dockerFails?: () => boolean;
    now?: () => number;
  }) {
    const totalKb = 16 * 1024 * 1024;
    let dockerCalls = 0;
    let reads = 0;
    const instance = new HostMemoryProbe({
      env: {},
      kernelRelease: () => '6.10.14-linuxkit',
      ...(scenario.now ? { now: scenario.now } : {}),
      readFile: () => {
        reads += 1;
        return Promise.resolve(
          meminfo(totalKb, scenario.available?.() ?? 4194304),
        );
      },
      docker: (args) => {
        dockerCalls += 1;
        if (scenario.dockerFails?.() === true) {
          return Promise.resolve({
            exitCode: 124,
            stdout: '',
            stderr: 'timed out',
            stdoutTruncated: false,
            stderrTruncated: false,
          });
        }
        const stdout =
          args[0] === 'context'
            ? JSON.stringify(scenario.endpoint ?? 'unix:///var/run/docker.sock')
            : JSON.stringify({
                memory: scenario.daemonTotalBytes ?? totalKb * 1024,
                kernel: scenario.kernel ?? '6.10.14-linuxkit',
              });
        return Promise.resolve({
          exitCode: 0,
          stdout,
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      },
    });
    return { instance, dockerCalls: () => dockerCalls, reads: () => reads };
  }

  test('reads MemAvailable where /proc describes the Docker host', async () => {
    const { instance } = probe({});
    expect(await instance.read()).toEqual({
      totalBytes: 16 * GIB,
      availableBytes: 4 * GIB,
    });
  });

  test.each([
    ['a remote daemon', { endpoint: 'tcp://10.0.0.5:2376' }],
    ['another kernel', { kernel: '5.15.0-generic' }],
    ['another total', { daemonTotalBytes: 32 * GIB }],
  ])(
    'answers null for %s, leaving admission to the count',
    async (_, scenario) => {
      expect(await probe(scenario).instance.read()).toBeNull();
    },
  );

  test('reuses a reading briefly, judges the host once, and reads afresh on request', async () => {
    let available = 4 * 1024 * 1024;
    const { instance, dockerCalls } = probe({ available: () => available });
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
    available = 2 * 1024 * 1024;
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
    expect((await instance.read(true))?.availableBytes).toBe(2 * GIB);
    expect(dockerCalls()).toBe(2);
  });

  test('concurrent reads share one', async () => {
    let now = 1_000_000;
    const { instance, reads } = probe({ now: () => now });
    await instance.read();
    // The verdict read /proc once, the reading once.
    expect(reads()).toBe(2);
    now += 5_000;
    const shared = await Promise.all([
      instance.read(),
      instance.read(),
      instance.read(),
    ]);
    expect(shared.every((m) => m?.availableBytes === 4 * GIB)).toBe(true);
    expect(reads()).toBe(3);
  });

  test('a Docker CLI that could not answer is asked again within a minute, not in ten', async () => {
    let now = 1_000_000;
    let fails = true;
    const { instance } = probe({ now: () => now, dockerFails: () => fails });
    expect(await instance.read()).toBeNull();
    fails = false;
    now += 31_000;
    expect((await instance.read())?.availableBytes).toBe(4 * GIB);
  });

  test('a re-judge the Docker CLI cannot answer keeps a good verdict', async () => {
    let now = 1_000_000;
    let fails = false;
    let available = 2 * 1024 * 1024;
    const { instance } = probe({
      now: () => now,
      dockerFails: () => fails,
      available: () => available,
    });
    expect((await instance.read())?.availableBytes).toBe(2 * GIB);
    // Ten minutes on, the verdict is due again while every CLI slot is busy.
    fails = true;
    available = 3 * 1024 * 1024;
    now += 10 * 60_000 + 1;
    expect((await instance.read())?.availableBytes).toBe(3 * GIB);
    // Still failing at the quick retry: still the host's memory.
    now += 31_000;
    expect((await instance.read())?.availableBytes).toBe(3 * GIB);
  });

  test('started, it keeps the reading admission decides with fresh', async () => {
    let available = 4 * 1024 * 1024;
    const { instance } = probe({ available: () => available });
    await instance.read();
    available = 2 * 1024 * 1024;
    instance.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      expect(instance.latest()?.availableBytes).toBe(2 * GIB);
    } finally {
      instance.stop();
    }
  });
});
