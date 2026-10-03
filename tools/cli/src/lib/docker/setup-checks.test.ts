import { describe, expect, mock, test } from 'bun:test';

import { checkCompose, collectSetupChecks } from './setup-checks';

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
      return options.server ?? JSON.stringify({ Os: 'linux', Arch: 'amd64' });
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
