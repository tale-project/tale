import { describe, expect, test } from 'bun:test';

import { DockerDataDiskProbe, SandboxDiskProbe } from './docker-data-disk.ts';
import {
  belowDiskFloor,
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
