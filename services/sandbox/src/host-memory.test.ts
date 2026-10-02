import { describe, expect, test } from 'bun:test';

import {
  autoSessionCapacity,
  HostMemoryProbe,
  memoryReserveBytes,
  sessionWorkingSetBytes,
} from './host-memory.ts';

const GIB = 1024 ** 3;

describe('sizing from the host', () => {
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

  test('a starting session is planned at its kind of working set', () => {
    expect(sessionWorkingSetBytes('default', true)).toBe(256 * 1024 ** 2);
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
  }) {
    const totalKb = 16 * 1024 * 1024;
    let dockerCalls = 0;
    const instance = new HostMemoryProbe({
      env: {},
      kernelRelease: () => '6.10.14-linuxkit',
      readFile: () =>
        Promise.resolve(meminfo(totalKb, scenario.available?.() ?? 4194304)),
      docker: (args) => {
        dockerCalls += 1;
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
    return { instance, dockerCalls: () => dockerCalls };
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
});
