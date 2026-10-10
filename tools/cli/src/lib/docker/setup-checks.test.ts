import { describe, expect, mock, test } from 'bun:test';

import {
  assertDockerEngineSupported,
  checkCompose,
  checkDockerEngine,
  collectSetupChecks,
  MIN_DOCKER_ENGINE_MAJOR,
} from './setup-checks';

/** `docker version --format '{{json .Server}}'` as a Docker Engine answers. */
function dockerServer(version: string, extra: Record<string, unknown> = {}) {
  return {
    Platform: { Name: 'Docker Engine - Community' },
    Version: version,
    Os: 'linux',
    Arch: 'amd64',
    Components: [
      { Name: 'Engine', Version: version },
      { Name: 'containerd', Version: '1.7.27' },
    ],
    ...extra,
  };
}

function dependencies(
  options: {
    endpoint?: string;
    server?: string;
    help?: string;
    compose?: string | null;
  } = {},
) {
  const probe = mock(async (args: string[]): Promise<string | null> => {
    if (args[0] === 'context') return options.endpoint ?? 'unix:///docker.sock';
    if (args[0] === 'version')
      return options.server ?? JSON.stringify(dockerServer('29.1.3'));
    if (args[1] === 'version')
      return options.compose === undefined ? '2.40.0' : options.compose;
    if (args[1] === 'up')
      return (
        options.help ?? '  --wait   Wait for services\n  --wait-timeout int'
      );
    throw new Error(`Unexpected probe: ${args.join(' ')}`);
  });
  return {
    probe,
    daemon: mock(async () => ({
      name: 'docker daemon',
      status: 'ok' as const,
      detail: 'reachable',
    })),
    port: mock(async (port: number, _host: string) => ({
      id: `port-${port}`,
      status: 'ok' as const,
      detail: 'available',
    })),
    env: {},
  };
}

describe('first-run setup checks', () => {
  test('the fixed sandbox port cannot also serve HTTPS', async () => {
    const result = await collectSetupChecks(8003, dependencies());
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'https-port', status: 'fail' }),
    );
  });
  test('missing Compose gives installation guidance before startup', async () => {
    const deps = dependencies({ compose: null });
    const result = await checkCompose(deps.probe);
    expect(result.status).toBe('fail');
    expect(result.fix).toContain('Compose plugin');
    expect(deps.probe).toHaveBeenCalledTimes(1);
  });

  test('Compose must support both readiness options, regardless of its version label', async () => {
    for (const help of ['--wait Wait for services', '--wait-timeout int', '']) {
      expect((await checkCompose(dependencies({ help }).probe)).status).toBe(
        'fail',
      );
    }
    expect((await checkCompose(dependencies().probe)).status).toBe('ok');
  });

  test('checks selected HTTPS and fixed sandbox ports without a project', async () => {
    const deps = dependencies();
    const result = await collectSetupChecks(8443, deps);
    expect(result.ready).toBe(true);
    expect(deps.port.mock.calls).toEqual([
      [8443, '0.0.0.0'],
      [8003, '127.0.0.1'],
    ]);
    expect(result.checks.map((check) => check.id)).toEqual([
      'docker',
      'compose',
      'runtime',
      'engine',
      'port-8443',
      'port-8003',
    ]);
  });

  test('a missing daemon is blocking and does not report a runtime platform', async () => {
    const deps = dependencies();
    const result = await collectSetupChecks(443, {
      ...deps,
      daemon: async () => ({
        name: 'docker',
        status: 'fail',
        detail: 'not reachable',
        fix: 'Start Docker',
      }),
    });
    expect(result.ready).toBe(false);
    expect(result.checks[0].fix).toBe('Start Docker');
    expect(result.checks.some((check) => check.id === 'runtime')).toBe(false);
    expect(result.checks.some((check) => check.id === 'engine')).toBe(false);
  });

  test('rejects Windows containers and explains how to switch', async () => {
    const result = await collectSetupChecks(
      443,
      dependencies({ server: '{"Os":"windows","Arch":"amd64"}' }),
    );
    expect(result.ready).toBe(false);
    expect(
      result.checks.find((check) => check.id === 'runtime')?.fix,
    ).toContain('Linux containers');
  });

  test('ARM64 warns about unverified emulation without claiming it is broken', async () => {
    const result = await collectSetupChecks(
      443,
      dependencies({ server: '{"Os":"linux","Arch":"arm64"}' }),
    );
    expect(result.ready).toBe(true);
    expect(result.checks.find((check) => check.id === 'runtime')).toMatchObject(
      { status: 'warn' },
    );
    expect(
      result.checks.find((check) => check.id === 'runtime')?.detail,
    ).toContain('does not test emulation');
  });

  test('remote Docker skips local socket checks, including when DOCKER_HOST is set', async () => {
    for (const endpoint of [
      'ssh://operator@example.test',
      'tcp://127.0.0.1:2375',
      '',
    ]) {
      const deps = dependencies({ endpoint });
      const result = await collectSetupChecks(8443, deps);
      expect(deps.port).not.toHaveBeenCalled();
      expect(
        result.checks.find((check) => check.id === 'ports')?.detail,
      ).toContain('skipped');
    }
    const deps = dependencies();
    await collectSetupChecks(443, {
      ...deps,
      env: { DOCKER_HOST: 'ssh://example.test' },
    });
    expect(deps.port).not.toHaveBeenCalled();
  });

  test('explicit Docker context takes precedence over DOCKER_HOST', async () => {
    const deps = dependencies();
    await collectSetupChecks(443, {
      ...deps,
      env: {
        DOCKER_CONTEXT: 'desktop-linux',
        DOCKER_HOST: 'ssh://example.test',
      },
    });
    expect(deps.port).toHaveBeenCalledTimes(2);
  });

  test('malformed daemon metadata produces an advisory, not a crash or false success', async () => {
    for (const server of ['not json', '{}', '{"Os":42,"Arch":"amd64"}']) {
      const result = await collectSetupChecks(443, dependencies({ server }));
      expect(
        result.checks.find((check) => check.id === 'runtime')?.status,
      ).toBe('warn');
    }
  });

  test('occupied ports remain advisory because an existing instance may own them', async () => {
    const result = await collectSetupChecks(443, {
      ...dependencies(),
      port: async (port) => ({
        id: `port-${port}`,
        status: 'warn',
        detail: 'Port in use',
      }),
    });
    expect(result.ready).toBe(true);
    expect(
      result.checks.filter((check) => check.status === 'warn'),
    ).toHaveLength(2);
  });
});

describe('the Docker Engine floor', () => {
  test('is Engine 24, which also pulls the zstd-compressed images Tale publishes', () => {
    expect(MIN_DOCKER_ENGINE_MAJOR).toBe(24);
  });

  test('accepts Engine 24 and later, release candidates and distribution builds', () => {
    for (const version of [
      '24.0.0',
      '24.0.0-rc.1',
      '28.3.2',
      '29.6.1',
      '26.1.5+dfsg1',
    ]) {
      expect(checkDockerEngine(dockerServer(version))).toEqual({
        id: 'engine',
        status: 'ok',
        detail: `Docker Engine ${version}.`,
      });
    }
  });

  test('refuses an engine that cannot pull zstd layers and says why', () => {
    for (const version of ['20.10.24', '17.03.2-ce', '1.13.1']) {
      const result = checkDockerEngine(dockerServer(version));
      expect(result.status).toBe('fail');
      expect(result.detail).toContain(
        `Docker Engine ${version} is older than 24.0`,
      );
      expect(result.detail).toContain('zstd-compressed');
      expect(result.fix).toContain('Docker Engine 24.0 or later');
    }
  });

  test('refuses Engine 23, which pulls zstd but is older than the supported floor', () => {
    const result = checkDockerEngine(dockerServer('23.0.6'));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('older than 24.0');
    expect(result.detail).not.toContain('cannot pull');
  });

  test("judges the engine component, not the server's own label", () => {
    // Docker Desktop names its own release in Platform; Version and the
    // Engine component carry the engine's.
    const desktop = {
      ...dockerServer('29.6.1'),
      Platform: { Name: 'Docker Desktop 4.82.0 (233772)' },
    };
    expect(checkDockerEngine(desktop).status).toBe('ok');
    const mismatched = dockerServer('29.6.1', {
      Components: [{ Name: 'Engine', Version: '20.10.24' }],
    });
    expect(checkDockerEngine(mismatched).status).toBe('fail');
  });

  test('an engine too old to list components is judged by its version', () => {
    expect(
      checkDockerEngine({ Version: '17.03.2-ce', Os: 'linux' }).status,
    ).toBe('fail');
    expect(checkDockerEngine({ Version: '25.0.3', Os: 'linux' }).status).toBe(
      'ok',
    );
  });

  test('another engine behind the Docker API is reported, never refused', () => {
    const podman = {
      Version: '5.2.0',
      Os: 'linux',
      Arch: 'amd64',
      Components: [{ Name: 'Podman Engine', Version: '5.2.0' }],
    };
    const result = checkDockerEngine(podman);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('Podman Engine');
  });

  test('unreadable metadata is an advisory, not a refusal', () => {
    for (const server of [
      null,
      'text',
      {},
      { Version: 'dev' },
      { Components: 'x' },
    ]) {
      expect(checkDockerEngine(server)).toMatchObject({
        id: 'engine',
        status: 'warn',
        detail: 'Could not determine the Docker Engine version.',
      });
    }
  });

  test('doctor fails on an old engine and keeps the platform check', async () => {
    const result = await collectSetupChecks(
      443,
      dependencies({ server: JSON.stringify(dockerServer('20.10.24')) }),
    );
    expect(result.ready).toBe(false);
    expect(result.checks.find((check) => check.id === 'runtime')?.status).toBe(
      'ok',
    );
    expect(result.checks.find((check) => check.id === 'engine')?.status).toBe(
      'fail',
    );
  });

  test('the launch path refuses an old engine with the reason and the fix', async () => {
    const old = dependencies({
      server: JSON.stringify(dockerServer('20.10.24')),
    });
    let refused: unknown;
    try {
      await assertDockerEngineSupported(old.probe);
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({
      info: {
        summary: expect.stringContaining('zstd-compressed'),
        next: expect.stringContaining('Docker Engine 24.0 or later'),
      },
    });
    for (const server of [JSON.stringify(dockerServer('29.1.3')), 'not json']) {
      expect(
        await assertDockerEngineSupported(dependencies({ server }).probe),
      ).toBeUndefined();
    }
  });
});
