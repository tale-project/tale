import { describe, expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';

import { HostAdmissionProbe } from './host-admission-probe.ts';
import type { RunDockerResult } from './spawn-util.ts';

const GIB = 1024 ** 3;
const CID = 'a'.repeat(64);
const BOOT = '12345678-abcd-1234-abcd-123456789012';
const owner = {
  daemonId: 'daemon-id',
  hostBootId: BOOT,
  containerId: CID,
  imageId: `sha256:${'b'.repeat(64)}`,
  startedAt: '2026-10-08T01:00:00Z',
  generation: '12345678-abcd-1234-abcd-123456789013',
  recordId: 'c'.repeat(64),
};
const workspace = { hostPath: '/srv/sessions', containerPath: '/sessions' };

function fixture() {
  const info = {
    id: owner.daemonId,
    kernel: '6.12.1',
    memory: 64 * GIB,
    cpus: 8,
    root: '/var/lib/docker',
    runtime: 'runc',
  };
  const self = {
    id: CID,
    hostname: `/var/lib/docker/containers/${CID}/hostname`,
    runtime: 'runc',
    mounts: [
      {
        Type: 'bind',
        Source: '/srv/sessions',
        Destination: '/sessions',
        RW: true,
      },
    ],
  };
  const disk = {
    dev: '2049',
    ino: '100',
    type: '61267',
    total: String(100 * GIB),
    available: String(80 * GIB),
  };
  const snapshot = {
    mounts:
      [
        '1 0 0:1 / / rw - overlay overlay rw',
        '2 1 0:2 / /proc rw - proc proc rw',
        '3 2 0:2 /sys /proc/sys ro - proc proc rw',
        '4 1 0:3 / /sys ro - sysfs sysfs ro',
        '5 1 8:1 /srv/sessions /sessions rw - ext4 /dev/sda1 rw',
        `6 1 8:1 /var/lib/docker/containers/${CID}/hostname /etc/hostname rw - ext4 /dev/sda1 rw`,
      ].join('\n') + '\n',
    values: [
      `${BOOT}\n`,
      '6.12.1\n',
      `MemTotal: ${(64 * GIB) / 1024} kB\nMemAvailable: ${(48 * GIB) / 1024} kB\n`,
      '0.12 0.15 0.18 2/100 123\n',
      ...Array.from(
        { length: 3 },
        () =>
          'some avg10=0.25 avg60=0.10 avg300=0.05 total=300\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
      ),
      '0-3,4-7\n',
    ],
    workspace: { ...disk },
    metadata: { ...disk, ino: '101', available: String(79 * GIB) },
  };
  const state = {
    now: 30_000,
    elapsed: 0,
    ownerCalls: 0,
    ownerBudgets: [] as number[],
    calls: [] as string[][],
    unavailable: false,
    truncated: false,
    samples: 0,
    afterDocker: (_count: number) => {},
    afterSample: () => {},
    afterOwner: (_count: number) => {},
  };
  const probe = new HostAdmissionProbe(
    owner,
    (budget: number) => {
      state.ownerCalls++;
      state.ownerBudgets.push(budget);
      state.afterOwner(state.ownerCalls);
      return Promise.resolve();
    },
    workspace,
    {
      clock: () => state.now,
      monotonic: () => state.elapsed,
      docker: (args, timeout) => {
        expect(timeout > 0 && timeout <= 5000).toBe(true);
        state.calls.push(args);
        if (args[0] === 'inspect') expect(args.at(-1)).toBe(CID);
        state.afterDocker(state.calls.length);
        return Promise.resolve({
          exitCode: state.unavailable ? 1 : 0,
          stdout: JSON.stringify(args[0] === 'info' ? info : self),
          stderr: '',
          stdoutTruncated: state.truncated,
          stderrTruncated: false,
        } satisfies RunDockerResult);
      },
      sample: (path, timeout) => {
        expect(path).toBe('/sessions');
        expect(timeout > 0 && timeout <= 3000).toBe(true);
        state.samples++;
        state.afterSample();
        return Promise.resolve(JSON.stringify(snapshot));
      },
    },
  );
  return { probe, info, self, snapshot, state };
}

describe('disabled strict fresh host admission probe', () => {
  test('binds fresh kernel metrics and the smaller free-space reading to the actual owner and shared filesystem', async () => {
    const f = fixture();
    const result = await f.probe.read();
    expect(result).toMatchObject({
      identity: {
        daemonId: owner.daemonId,
        hostBootId: BOOT,
        authorityGeneration: owner.generation,
      },
      observedAt: 30_000,
      onlineCpus: 8,
      load1: 0.12,
      cpuPsi: 0.25,
      memoryPsi: 0.25,
      ioPsi: 0.25,
      memoryTotalBytes: 64 * GIB,
      memoryAvailableBytes: 48 * GIB,
      diskAvailableBytes: 79 * GIB,
    });
    expect(result.identity.filesystemId).toMatch(/^[a-f0-9]{64}$/);
    expect(f.state.ownerCalls).toBe(2);
    expect(f.state.calls.map((call) => call[0])).toEqual([
      'info',
      'inspect',
      'info',
      'inspect',
    ]);
    expect(f.state.samples).toBe(2);
  });

  test('an old successful provenance result never masks the next failed daemon read', async () => {
    const f = fixture();
    await f.probe.read();
    f.state.unavailable = true;
    await rejects(f.probe.read(), /unavailable/);
    expect(f.state.samples).toBe(2);
  });

  test('the final owner read receives only the remaining shared budget', async () => {
    const f = fixture();
    f.state.afterSample = () => {
      if (f.state.samples === 2) f.state.elapsed = 19_999;
    };
    await f.probe.read();
    expect(f.state.ownerBudgets).toEqual([15_000, 1]);
  });

  test('a late final owner response never produces evidence', async () => {
    const f = fixture();
    f.state.afterSample = () => {
      if (f.state.samples === 2) f.state.elapsed = 19_999;
    };
    f.state.afterOwner = (count) => {
      if (count === 2) f.state.elapsed = 20_000;
    };
    await rejects(f.probe.read());
    expect(f.state.ownerBudgets).toEqual([15_000, 1]);
  });

  test.each(['mount', 'inode', 'late'] as const)(
    'refuses a %s change during final native readback',
    async (kind) => {
      const f = fixture();
      f.state.afterSample = () => {
        if (f.state.samples !== 2) return;
        if (kind === 'mount')
          f.snapshot.mounts = f.snapshot.mounts.replace('5 1 8:1', '8 1 8:1');
        if (kind === 'inode') f.snapshot.workspace.ino = '999';
        if (kind === 'late') f.state.elapsed = 20_000;
      };
      await rejects(f.probe.read());
    },
  );

  test.each(['daemon', 'mounts', 'owner', 'deadline', 'backwards'] as const)(
    'refuses changed final %s without returning a snapshot',
    async (kind) => {
      const f = fixture();
      f.state.afterDocker = (count) => {
        if (kind === 'daemon' && count === 3) f.info.id = 'replacement';
        if (kind === 'mounts' && count === 4)
          f.self.mounts[0]!.Source = '/replacement';
        if (kind === 'deadline' && count === 4) f.state.elapsed = 20_000;
      };
      f.state.afterOwner = (count) => {
        if (count !== 2) return;
        if (kind === 'owner') throw new Error('owner changed');
        if (kind === 'backwards') f.state.now = 29_999;
      };
      await rejects(f.probe.read());
    },
  );

  test.each([
    [
      'changed boot',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[0] = 'other';
      },
    ],
    [
      'changed kernel',
      (f: ReturnType<typeof fixture>) => {
        f.info.kernel = 'other';
      },
    ],
    [
      'different memory',
      (f: ReturnType<typeof fixture>) => {
        f.info.memory++;
      },
    ],
    [
      'different cpu count',
      (f: ReturnType<typeof fixture>) => {
        f.info.cpus++;
      },
    ],
    [
      'virtual runtime',
      (f: ReturnType<typeof fixture>) => {
        f.self.runtime = 'sysbox-runc';
      },
    ],
    [
      'unknown daemon runtime',
      (f: ReturnType<typeof fixture>) => {
        f.info.runtime = 'unknown';
      },
    ],
    [
      'wrong container',
      (f: ReturnType<typeof fixture>) => {
        f.self.id = 'd'.repeat(64);
      },
    ],
    [
      'wrong data root',
      (f: ReturnType<typeof fixture>) => {
        f.info.root = '/replacement';
      },
    ],
    [
      'unknown workspace',
      (f: ReturnType<typeof fixture>) => {
        f.self.mounts = [];
      },
    ],
    [
      'duplicate workspace',
      (f: ReturnType<typeof fixture>) => {
        f.self.mounts.push({ ...f.self.mounts[0]! });
      },
    ],
    [
      'wrong workspace source',
      (f: ReturnType<typeof fixture>) => {
        f.self.mounts[0]!.Source = '/other';
      },
    ],
    [
      'virtual meminfo',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.mounts +=
          '7 2 0:9 /meminfo /proc/meminfo ro - fuse.lxcfs lxcfs rw\n';
      },
    ],
    [
      'different proc file',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.mounts +=
          '7 2 0:2 /loadavg /proc/meminfo ro - proc proc rw\n';
      },
    ],
    [
      'duplicate mount path',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.mounts += '7 2 0:9 / /proc ro - proc proc rw\n';
      },
    ],
    [
      'duplicate mount id',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.mounts += '2 1 0:9 / /other ro - proc proc rw\n';
      },
    ],
    [
      'separate disk',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.workspace.dev = '2050';
      },
    ],
    [
      'separate mount device',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.mounts = f.snapshot.mounts.replace('5 1 8:1', '5 1 8:2');
      },
    ],
    [
      'missing memory',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[2] = 'MemTotal: 20 kB\n';
      },
    ],
    [
      'duplicate memory',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[2] += 'MemAvailable: 100 kB\n';
      },
    ],
    [
      'duplicate online cpu',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[7] = '0-3,3-6';
      },
    ],
    [
      'missing pressure',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[5] = '';
      },
    ],
    [
      'pressure above bound',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[5] =
          'some avg10=100.01 avg60=0.00 avg300=0.00 total=0\n';
      },
    ],
    [
      'duplicate pressure',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[5] =
          'some avg10=0.01 avg60=0.00 avg300=0.00 total=0\nsome avg10=0.01 avg60=0.00 avg300=0.00 total=0\n';
      },
    ],
    [
      'negative load',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.values[3] = '-1.00 0.00 0.00 1/20 1';
      },
    ],
    [
      'impossible free space',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.workspace.available = String(101 * GIB);
        f.snapshot.metadata.available = String(101 * GIB);
      },
    ],
    [
      'unsafe integer',
      (f: ReturnType<typeof fixture>) => {
        f.snapshot.workspace.total = '9007199254740992';
      },
    ],
    [
      'truncated transport',
      (f: ReturnType<typeof fixture>) => {
        f.state.truncated = true;
      },
    ],
  ] as const)('holds on %s', async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    await rejects(f.probe.read());
  });

  test('a remounted filesystem changes its stable identity even when free bytes are equal', async () => {
    const f = fixture();
    const first = await f.probe.read();
    f.snapshot.mounts = f.snapshot.mounts.replace('5 1 8:1', '8 1 8:1');
    const next = await f.probe.read();
    expect(first.identity.filesystemId).not.toBe(next.identity.filesystemId);
  });

  test('invalid boot-owned path is refused before subprocess or daemon access', () => {
    for (const containerPath of [
      '/',
      '/sessions/../other',
      'relative',
      '/sessions\n',
    ])
      expect(
        () =>
          new HostAdmissionProbe(owner, () => Promise.resolve(), {
            ...workspace,
            containerPath,
          }),
      ).toThrow();
  });
});
