import { describe, expect, test } from 'bun:test';

import {
  DockerDataDiskProbe,
  mountLineFor,
  SandboxDiskProbe,
} from './docker-data-disk.ts';
import {
  belowDiskFloor,
  HostDiskProbe,
  type HostDisk,
  type HostDiskSource,
} from './host-disk.ts';
import type { RunDockerResult } from './spawn-util.ts';

const GIB = 1024 ** 3;
const result = (value: unknown): RunDockerResult => ({
  exitCode: 0,
  stdout: JSON.stringify(value),
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
});
const source = (get: () => HostDisk | null): HostDiskSource => ({
  latest: get,
  read: async () => get(),
});

describe('Docker data filesystem admission', () => {
  test('protects both filesystems using their own reserve, without adding their capacity', async () => {
    let dockerFree = 15;
    const statfs = async (path: string) => ({
      bsize: GIB,
      blocks: path === '/sessions' ? 100 : 1000,
      bavail: path === '/sessions' ? 8 : dockerFree,
    });
    const probe = new SandboxDiskProbe(
      new HostDiskProbe('/sessions', undefined, { statfs }),
      new DockerDataDiskProbe(undefined, {
        mount: { read: async () => '/etc/hostname' },
        disk: new HostDiskProbe('/etc/hostname', undefined, { statfs }),
      }),
      undefined,
      false,
    );
    // Docker has MORE bytes free but less headroom against its 20 GiB floor.
    expect(await probe.read()).toEqual({
      totalBytes: 1000 * GIB,
      availableBytes: 15 * GIB,
      filesystem: '/etc/hostname',
    });
    expect(belowDiskFloor(probe.latest())).toBe(true);
    dockerFree = 30;
    expect(await probe.read(true)).toEqual({
      totalBytes: 100 * GIB,
      availableBytes: 8 * GIB,
      filesystem: '/sessions',
    });
    expect(belowDiskFloor(probe.latest())).toBe(false);
  });

  test('keeps workspace admission when automatic Docker storage cannot be verified or read', async () => {
    for (const path of [null, '/etc/hostname']) {
      const probe = new SandboxDiskProbe(
        source(() => ({ totalBytes: 100 * GIB, availableBytes: 4 * GIB })),
        new DockerDataDiskProbe(undefined, {
          mount: { read: async () => path },
          disk: source(() => null),
        }),
        undefined,
        false,
      );
      expect(belowDiskFloor(await probe.read())).toBe(true);
      expect(probe.status().dockerData).toBe('unavailable');
    }
  });

  test('automatic discovery observes Docker pressure and falls back to workspace while unavailable', async () => {
    let mount: string | null = '/etc/hostname';
    let reads = 0;
    const workspace = { totalBytes: 100 * GIB, availableBytes: 20 * GIB };
    const docker = {
      totalBytes: 100 * GIB,
      availableBytes: GIB,
      filesystem: '/etc/hostname',
    };
    const data = new DockerDataDiskProbe(undefined, {
      mount: { read: async () => mount },
      disk: source(() => {
        reads++;
        return docker;
      }),
    });
    const disks = new SandboxDiskProbe(
      source(() => workspace),
      data,
      undefined,
      false,
    );
    expect(await disks.read()).toEqual(docker);
    expect(belowDiskFloor(disks.latest())).toBe(true);
    expect(disks.status().dockerData).toBe('ready');
    mount = null;
    expect(await disks.read(true)).toEqual(workspace);
    expect(disks.status().dockerData).toBe('unavailable');
    expect(reads).toBe(1);
    mount = '/etc/hostname';
    expect(await disks.read(true)).toEqual(docker);
    expect(disks.status().dockerData).toBe('ready');
  });

  test('an explicit invalid mount never falls back to automatic discovery', async () => {
    let autoReads = 0;
    const data = new DockerDataDiskProbe(
      { path: '/docker-data', root: '/expected-root' },
      {
        mount: {
          read: async () => {
            autoReads++;
            return '/etc/hostname';
          },
        },
        docker: async () => result('/different-root'),
        disk: source(() => ({
          totalBytes: 100 * GIB,
          availableBytes: 90 * GIB,
        })),
      },
    );
    const disks = new SandboxDiskProbe(
      source(() => ({ totalBytes: 100 * GIB, availableBytes: 90 * GIB })),
      data,
    );
    expect((await disks.read())?.unavailable).toBe(true);
    expect(autoReads).toBe(0);
    expect(disks.status().dockerData).toBe('unavailable');
  });

  test('a separate full Docker disk blocks admission despite an empty workspace disk', async () => {
    const data = new DockerDataDiskProbe(
      { path: '/docker-data', root: '/srv/docker' },
      {
        hostname: 'a'.repeat(12),
        docker: async (args) =>
          args[0] === 'info'
            ? result('/srv/docker')
            : result([
                {
                  Type: 'bind',
                  Source: '/srv/docker',
                  Destination: '/docker-data',
                  RW: false,
                },
              ]),
        disk: source(() => ({ totalBytes: 100 * GIB, availableBytes: GIB })),
      },
    );
    const disks = new SandboxDiskProbe(
      source(() => ({ totalBytes: 200 * GIB, availableBytes: 100 * GIB })),
      data,
    );
    expect(belowDiskFloor(await disks.read())).toBe(true);
    expect(disks.status()).toEqual({ workspace: 'ready', dockerData: 'ready' });
  });

  test.each([
    {
      Type: 'bind',
      Source: '/other-disk',
      Destination: '/docker-data',
      RW: false,
    },
    {
      Type: 'bind',
      Source: '/srv/docker',
      Destination: '/docker-data',
      RW: true,
    },
    {
      Type: 'volume',
      Source: '/srv/docker',
      Destination: '/docker-data',
      RW: false,
    },
  ])(
    'an unverified configured mount closes admission without deleting caches: %j',
    async (mount) => {
      let reads = 0;
      const data = new DockerDataDiskProbe(
        { path: '/docker-data' },
        {
          hostname: 'a'.repeat(12),
          docker: async (args) =>
            args[0] === 'info' ? result('/srv/docker') : result([mount]),
          disk: source(() => {
            reads++;
            return { totalBytes: 100 * GIB, availableBytes: 90 * GIB };
          }),
        },
      );
      const disks = new SandboxDiskProbe(
        source(() => ({ totalBytes: 200 * GIB, availableBytes: 100 * GIB })),
        data,
      );
      expect((await disks.read())?.unavailable).toBe(true);
      expect(belowDiskFloor(disks.latest())).toBe(true);
      expect(reads).toBe(0);
      expect(disks.status().dockerData).toBe('unavailable');
    },
  );

  describe('an explicit mount is verified with the daemon once per process', () => {
    const bindLine = (mountId: number) =>
      `${mountId} 25 8:17 /srv/docker /docker-data ro,relatime - ext4 /dev/sdb1 rw`;
    function explicit(
      binding: { RW: boolean } = { RW: false },
      inspect?: () => RunDockerResult,
    ) {
      const state = {
        now: 0,
        readable: true,
        mountinfo: `1 0 8:1 / / rw - ext4 /dev/sda1 rw\n${bindLine(40)}\n`,
        calls: [] as string[][],
      };
      const data = new DockerDataDiskProbe(
        { path: '/docker-data', root: '/srv/docker' },
        {
          hostname: 'a'.repeat(12),
          now: () => state.now,
          readFile: async () => state.mountinfo,
          docker: async (args) => {
            state.calls.push(args);
            if (args[0] !== 'info' && inspect !== undefined) return inspect();
            return args[0] === 'info'
              ? result('/srv/docker')
              : result([
                  {
                    Type: 'bind',
                    Source: '/srv/docker',
                    Destination: '/docker-data',
                    ...binding,
                  },
                ]);
          },
          disk: source(() =>
            state.readable
              ? { totalBytes: 100 * GIB, availableBytes: 50 * GIB }
              : null,
          ),
        },
      );
      return { state, data };
    }
    const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
      const warn = console.warn;
      console.warn = () => {};
      try {
        return await work();
      } finally {
        console.warn = warn;
      }
    };

    test('again only when the mount it lives on changes', async () => {
      const { state, data } = explicit();
      expect((await data.read(true))?.availableBytes).toBe(50 * GIB);
      expect(state.calls).toHaveLength(2);
      for (let tick = 0; tick < 200; tick += 1) {
        state.now += 5_000;
        await data.read(true);
      }
      expect(data.latest()?.availableBytes).toBe(50 * GIB);
      expect(state.calls).toHaveLength(2);
      // Remounted: verified again at the next comparison.
      state.mountinfo = state.mountinfo.replace(bindLine(40), bindLine(41));
      state.now += 60_000;
      expect((await data.read(true))?.availableBytes).toBe(50 * GIB);
      expect(state.calls).toHaveLength(4);
      // Its free space cannot be read: unavailable for that read only. The
      // mount it lives on is still the one verified, so the first readable
      // statfs reopens admission without asking Docker again.
      state.readable = false;
      state.now += 5_000;
      expect(await quietly(() => data.read(true))).toBeNull();
      state.readable = true;
      state.now += 5_000;
      expect((await data.read(true))?.availableBytes).toBe(50 * GIB);
      expect(state.calls).toHaveLength(4);
    });

    test('a daemon that answers "no such container" refutes the mount, and its retry delay grows', async () => {
      const { state, data } = explicit({ RW: false }, () => ({
        ...result(null),
        exitCode: 1,
        stdout: '',
        stderr: 'Error: No such container: aaaaaaaaaaaa',
      }));
      await quietly(async () => {
        expect(await data.read(true)).toBeNull();
        for (const [after, calls] of [
          [30_000, 4],
          [59_999, 4],
          [1, 6],
        ] as const) {
          state.now += after;
          expect(await data.read(true)).toBeNull();
          expect(state.calls).toHaveLength(calls);
        }
      });
    });

    test('a refuted mount stays unavailable and is asked again after 30 s, then 60 s', async () => {
      const { state, data } = explicit({ RW: true });
      await quietly(async () => {
        expect(await data.read(true)).toBeNull();
        for (const [after, calls] of [
          [5_000, 2],
          [25_000, 4],
          [59_999, 4],
          [1, 6],
        ] as const) {
          state.now += after;
          expect(await data.read(true)).toBeNull();
          expect(state.calls).toHaveLength(calls);
        }
      });
    });
  });

  test('the mount a path lives on is the longest mount point containing it, the last when stacked', () => {
    const info = [
      '1 0 8:1 / / rw - ext4 /dev/sda1 rw',
      '2 1 8:2 / /var rw - ext4 /dev/sda2 rw',
      '3 2 8:3 / /var/lib/docker rw - xfs /dev/sdb1 rw',
      '4 2 8:4 / /var/lib/docker rw - xfs /dev/sdc1 rw',
      '5 1 8:5 / /var/lib/docker2 rw - ext4 /dev/sdd1 rw',
      '6 1 8:6 / /my\\040data rw - ext4 /dev/sde1 rw',
    ].join('\n');
    expect(mountLineFor(info, '/var/lib/docker')).toContain('4 2 8:4');
    expect(mountLineFor(info, '/var/lib/docker/overlay2')).toContain('4 2 8:4');
    expect(mountLineFor(info, '/var/lib/containerd')).toContain('2 1 8:2');
    expect(mountLineFor(info, '/srv')).toContain('1 0 8:1');
    expect(mountLineFor(info, '/my data/docker')).toContain('6 1 8:6');
    expect(mountLineFor('', '/srv')).toBeNull();
  });

  test('an unconfigured deployment preserves workspace admission and reports the monitoring gap', async () => {
    const workspace = { totalBytes: 100 * GIB, availableBytes: 20 * GIB };
    const disks = new SandboxDiskProbe(source(() => workspace));
    expect(await disks.read()).toEqual(workspace);
    expect(disks.status().dockerData).toBe('unconfigured');
  });

  test('both filesystems are refreshed and admission follows whichever has less headroom', async () => {
    let workspace = { totalBytes: 100 * GIB, availableBytes: 2 * GIB };
    let docker = { totalBytes: 100 * GIB, availableBytes: 20 * GIB };
    const disks = new SandboxDiskProbe(
      source(() => workspace),
      source(() => docker),
    );
    expect(await disks.read()).toEqual(workspace);
    workspace = { ...workspace, availableBytes: 30 * GIB };
    docker = { ...docker, availableBytes: GIB };
    expect(await disks.read(true)).toEqual(docker);
  });
});
