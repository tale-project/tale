import { describe, expect, test } from 'bun:test';

import { DockerDataDiskProbe, SandboxDiskProbe } from './docker-data-disk.ts';
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
