import { describe, expect, mock, test } from 'bun:test';

import { volumeMountedAt } from './volume-mounted-at';

/** A fresh fake per test, injected directly — no `mock.module`. */
function inspectAnswers(result: { success: boolean; stdout?: string }) {
  return mock((..._args: string[]) =>
    Promise.resolve({
      stdout: '',
      stderr: '',
      exitCode: result.success ? 0 : 1,
      ...result,
    }),
  );
}

// What `docker container inspect --format '{{json .Mounts}}'` prints for the
// Caddy edge of Tale 0.5.
const CADDY_EDGE = JSON.stringify([
  {
    Type: 'volume',
    Name: 'tale_caddy-config',
    Source: '/var/lib/docker/volumes/tale_caddy-config/_data',
    Destination: '/config',
    Driver: 'local',
    Mode: 'z',
    RW: true,
    Propagation: '',
  },
  {
    Type: 'volume',
    Name: 'tale_caddy-data',
    Source: '/var/lib/docker/volumes/tale_caddy-data/_data',
    Destination: '/data',
    Driver: 'local',
    Mode: 'z',
    RW: true,
    Propagation: '',
  },
]);

describe('volumeMountedAt', () => {
  test('names the volume a container mounts at a path', async () => {
    const docker = inspectAnswers({ success: true, stdout: `${CADDY_EDGE}\n` });

    expect(await volumeMountedAt('tale-proxy', '/data', { docker })).toBe(
      'tale_caddy-data',
    );
    expect(docker).toHaveBeenCalledWith(
      'container',
      'inspect',
      '--format',
      '{{json .Mounts}}',
      'tale-proxy',
    );
  });

  test('is null when nothing, or a host path, is mounted there', async () => {
    const docker = inspectAnswers({
      success: true,
      stdout: JSON.stringify([
        {
          Type: 'bind',
          Source: '/srv/data',
          Destination: '/data',
          RW: true,
        },
      ]),
    });

    expect(await volumeMountedAt('tale-proxy', '/data', { docker })).toBeNull();
    expect(
      await volumeMountedAt('tale-proxy', '/srv', {
        docker: inspectAnswers({ success: true, stdout: CADDY_EDGE }),
      }),
    ).toBeNull();
    expect(
      await volumeMountedAt('tale-proxy', '/data', {
        docker: inspectAnswers({ success: true, stdout: 'null\n' }),
      }),
    ).toBeNull();
  });

  test('is null when there is no such container', async () => {
    expect(
      await volumeMountedAt('tale-proxy', '/data', {
        docker: inspectAnswers({ success: false }),
      }),
    ).toBeNull();
  });
});
