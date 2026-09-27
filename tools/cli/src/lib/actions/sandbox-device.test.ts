import { afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExecResult } from '../docker/exec';
import {
  buildSandboxDeviceConfig,
  readSandboxDeviceConfig,
  sandboxDeviceConfigPath,
  writeSandboxDeviceConfig,
} from '../sandbox-device/config';
import {
  connectSandboxDevice,
  deviceNameFrom,
  disconnectSandboxDevice,
  type SandboxDeviceDeps,
  sandboxDeviceStatus,
  updateSandboxDevice,
} from './sandbox-device';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const ok = (stdout = ''): ExecResult => ({
  success: true,
  stdout,
  stderr: '',
  exitCode: 0,
});

interface Recorded {
  requests: Array<{
    url: string;
    method: string;
    body: unknown;
    auth: string | null;
  }>;
  docker: string[][];
  streamed: string[][];
}

async function makeDeps(
  overrides: Partial<SandboxDeviceDeps> & {
    serverVersion?: string;
    connected?: boolean;
    joinStatus?: number;
  } = {},
): Promise<{ deps: SandboxDeviceDeps; home: string; rec: Recorded }> {
  const home = join(
    await mkdtemp(join(tmpdir(), 'tale-cli-device-')),
    'sandbox',
  );
  dirs.push(join(home, '..'));
  const rec: Recorded = { requests: [], docker: [], streamed: [] };
  const deps: SandboxDeviceDeps = {
    home: () => home,
    fetch: mock(async (url: string, init?: RequestInit) => {
      rec.requests.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        auth: new Headers(init?.headers).get('authorization'),
      });
      if (url.endsWith('/join')) {
        if (overrides.joinStatus !== undefined) {
          return Response.json(
            {
              error: 'This connect command has expired',
              code: 'JOIN_TOKEN_INVALID',
            },
            { status: overrides.joinStatus },
          );
        }
        return Response.json(
          {
            deviceId: 'dev-1',
            deviceSecret: 'tsd_secret',
            organizationId: 'org_acme',
            name: 'studio',
            serverUrl: 'https://acme.tale.dev',
            serverVersion: overrides.serverVersion ?? '0.5.60',
            tunnelUrl: 'wss://acme.tale.dev/sandbox/tunnel',
            relays: [{ name: 'api', url: 'http://backend-api:3005' }],
            registry: 'ghcr.io/tale-project/tale',
          },
          { status: 201 },
        );
      }
      if (url.endsWith('/self') && (init?.method ?? 'GET') === 'GET') {
        return Response.json({
          deviceId: 'dev-1',
          name: 'studio',
          organizationId: 'org_acme',
          organizationName: 'Acme',
          connected: overrides.connected ?? true,
          lastSeenAt: 1,
          serverVersion: overrides.serverVersion ?? '0.5.60',
        });
      }
      return Response.json({ removed: true });
    }),
    docker: mock(async (args: string[]) => {
      rec.docker.push(args);
      if (args[0] === 'info') return ok('8|17179869184|27.1.1');
      if (args[0] === 'container' && args[1] === 'inspect') {
        return ok(
          'running|healthy|ghcr.io/tale-project/tale/tale-sandbox:0.5.60',
        );
      }
      return ok();
    }),
    dockerStreamed: mock(async (args: string[]) => {
      rec.streamed.push(args);
      return 0;
    }),
    ensureDocker: mock(async () => ({ ok: true, detail: 'ready' })),
    hostname: () => 'studio.local',
    platform: () => ({ os: 'darwin', arch: 'arm64' }),
    sleep: async () => {},
    confirm: mock(async () => true),
    assumeYes: () => false,
    json: () => false,
    ...overrides,
  };
  return { deps, home, rec };
}

describe('tale sandbox connect', () => {
  test('joins with the machine facts, writes the config and starts the stack at the server release', async () => {
    const { deps, home, rec } = await makeDeps();
    await connectSandboxDevice(
      { url: 'https://acme.tale.dev/', token: 'tsdj_abc', autoUpdate: true },
      deps,
    );
    expect(rec.requests[0]).toEqual({
      url: 'https://acme.tale.dev/api/sandbox-devices/join',
      method: 'POST',
      body: {
        token: 'tsdj_abc',
        name: 'studio',
        maxSessions: 4,
        platform: {
          os: 'darwin',
          arch: 'arm64',
          cpus: 8,
          memoryBytes: 17179869184,
          dockerVersion: '27.1.1',
        },
      },
      auth: null,
    });
    const config = await readSandboxDeviceConfig(sandboxDeviceConfigPath(home));
    expect(config).toMatchObject({
      deviceId: 'dev-1',
      deviceSecret: 'tsd_secret',
      stateDir: home,
      maxSessions: 4,
      serverUrl: 'https://acme.tale.dev',
    });
    // The release's own helper lays the stack out.
    const run = rec.streamed[0] ?? [];
    expect(run.slice(0, 2)).toEqual(['run', '--rm']);
    expect(run).toContain('ghcr.io/tale-project/tale/tale-sandbox:0.5.60');
    expect(run.slice(-4)).toEqual([
      'device-apply',
      sandboxDeviceConfigPath(home),
      '--version',
      '0.5.60',
    ]);
    expect(run).toContain(`${home}:${home}`);
    // Then waits for the server to see it.
    expect(rec.requests.at(-1)?.auth).toBe('Bearer tsd_secret');
  });

  test('refuses a second connection and a non-token', async () => {
    const { deps } = await makeDeps();
    await expect(
      connectSandboxDevice(
        { url: 'https://acme.tale.dev', token: 'thk_nope', autoUpdate: true },
        deps,
      ),
    ).rejects.toThrow(/not a device connect token/);
    await connectSandboxDevice(
      { url: 'https://acme.tale.dev', token: 'tsdj_abc', autoUpdate: true },
      deps,
    );
    await expect(
      connectSandboxDevice(
        { url: 'https://acme.tale.dev', token: 'tsdj_again', autoUpdate: true },
        deps,
      ),
    ).rejects.toThrow(/already connected as "studio"/);
  });

  test('an expired command says to copy a new one; nothing is written', async () => {
    const { deps, home } = await makeDeps({ joinStatus: 401 });
    await expect(
      connectSandboxDevice(
        { url: 'https://acme.tale.dev', token: 'tsdj_old', autoUpdate: true },
        deps,
      ),
    ).rejects.toThrow(/expired or was already used/);
    expect(
      await readSandboxDeviceConfig(sandboxDeviceConfigPath(home)),
    ).toBeNull();
  });

  test('Windows is refused before anything happens', async () => {
    const { deps, rec } = await makeDeps({
      platform: () => ({ os: 'win32', arch: 'x64' }),
    });
    await expect(
      connectSandboxDevice(
        { url: 'https://acme.tale.dev', token: 'tsdj_abc', autoUpdate: true },
        deps,
      ),
    ).rejects.toThrow(/Linux and macOS/);
    expect(rec.requests).toHaveLength(0);
  });

  test('a development server needs explicit images', async () => {
    const { deps, rec } = await makeDeps({ serverVersion: 'dev' });
    await expect(
      connectSandboxDevice(
        { url: 'http://localhost:3000', token: 'tsdj_abc', autoUpdate: true },
        deps,
      ),
    ).rejects.toThrow(/development build/);
    expect(rec.streamed).toHaveLength(0);
    const local = await makeDeps({ serverVersion: 'dev' });
    await connectSandboxDevice(
      {
        url: 'http://localhost:3000',
        token: 'tsdj_abc',
        autoUpdate: true,
        deviceServerUrl: 'http://host.docker.internal:3000',
        images: {
          sandbox: 'tale-sandbox:local',
          runtime: 'tale-sandbox-runtime:latest',
          egress: 'tale-sandbox-egress:local',
        },
      },
      local.deps,
    );
    expect(local.rec.streamed[0]).toContain('tale-sandbox:local');
    const written = JSON.parse(
      await readFile(sandboxDeviceConfigPath(local.home), 'utf8'),
    );
    expect(written.serverUrl).toBe('http://host.docker.internal:3000');
    expect(written.cliServerUrl).toBe('http://localhost:3000');
  });
});

describe('tale sandbox status / update / disconnect', () => {
  async function connected() {
    const made = await makeDeps();
    const config = buildSandboxDeviceConfig(
      {
        deviceId: 'dev-1',
        deviceSecret: 'tsd_secret',
        organizationId: 'org_acme',
        name: 'studio',
        serverUrl: 'https://acme.tale.dev',
        serverVersion: '0.5.60',
        tunnelUrl: 'wss://acme.tale.dev/sandbox/tunnel',
        relays: [],
        registry: 'ghcr.io/tale-project/tale',
      },
      {
        stateDir: made.home,
        maxSessions: 3,
        host: { os: 'linux', arch: 'x64', hostname: 'studio' },
        autoUpdate: true,
        cliServerUrl: 'https://acme.tale.dev',
      },
    );
    await writeSandboxDeviceConfig(config, sandboxDeviceConfigPath(made.home));
    return made;
  }

  test('status reports the server view and the containers', async () => {
    const { deps } = await connected();
    const report = await sandboxDeviceStatus(deps);
    expect(report).toMatchObject({
      configured: true,
      connected: true,
      organization: 'Acme',
      serverVersion: '0.5.60',
      containers: { sandbox: 'running (healthy)', egress: 'running (healthy)' },
      maxSessions: 3,
    });
  });

  test('status on an unconnected machine says how to connect', async () => {
    const { deps } = await makeDeps();
    expect(await sandboxDeviceStatus(deps)).toEqual({
      connected: false,
      configured: false,
    });
  });

  test('update lays the stack out at the release the server names', async () => {
    const { deps, rec } = await connected();
    await updateSandboxDevice({}, deps);
    expect(rec.streamed[0]).toContain(
      'ghcr.io/tale-project/tale/tale-sandbox:0.5.60',
    );
  });

  test('disconnect leaves the organization, removes the stack and the data', async () => {
    const { deps, home, rec } = await connected();
    await disconnectSandboxDevice({ keepData: false, force: true }, deps);
    const leave = rec.requests.find((r) => r.method === 'DELETE');
    expect(leave).toMatchObject({
      url: 'https://acme.tale.dev/api/sandbox-devices/self',
      auth: 'Bearer tsd_secret',
    });
    const removed = rec.docker
      .filter((a) => a[0] === 'rm')
      .map((a) => a.at(-1));
    expect(removed).toEqual(
      expect.arrayContaining(['tale-device-sandbox', 'tale-device-egress']),
    );
    // Workspaces are removed by a root helper (sessions write as other users).
    expect(
      rec.docker.some((a) => a.includes('--entrypoint') && a.includes('rm')),
    ).toBe(true);
    expect(
      await readSandboxDeviceConfig(sandboxDeviceConfigPath(home)),
    ).toBeNull();
  });

  test('disconnect with Docker down changes nothing', async () => {
    const { deps, home, rec } = await connected();
    deps.docker = mock(async (args: string[]) => {
      rec.docker.push(args);
      return {
        success: false,
        stdout: '',
        stderr: 'Cannot connect to the Docker daemon',
        exitCode: 1,
      };
    });
    await expect(
      disconnectSandboxDevice({ keepData: false, force: true }, deps),
    ).rejects.toThrow(/Docker is not running/);
    // Still a member of its organization, and still configured.
    expect(rec.requests.some((r) => r.method === 'DELETE')).toBe(false);
    expect(
      await readSandboxDeviceConfig(sandboxDeviceConfigPath(home)),
    ).not.toBeNull();
  });

  test('a container that will not go fails the disconnect, keeping the config', async () => {
    const { deps, home } = await connected();
    const docker = deps.docker;
    deps.docker = mock(async (args: string[]) =>
      args[0] === 'rm' && args.at(-1) === 'tale-device-sandbox'
        ? {
            success: false,
            stdout: '',
            stderr: 'Error response from daemon: device or resource busy',
            exitCode: 1,
          }
        : docker(args),
    );
    await expect(
      disconnectSandboxDevice({ keepData: false, force: true }, deps),
    ).rejects.toThrow(/Could not remove tale-device-sandbox/);
    expect(
      await readSandboxDeviceConfig(sandboxDeviceConfigPath(home)),
    ).not.toBeNull();
  });

  test('update takes the addresses the server hands its sessions now', async () => {
    const { deps, home, rec } = await connected();
    const fetchImpl = deps.fetch;
    deps.fetch = mock(async (url: string, init?: RequestInit) =>
      url.endsWith('/self')
        ? Response.json({
            deviceId: 'dev-1',
            name: 'studio',
            organizationId: 'org_acme',
            organizationName: 'Acme',
            connected: true,
            lastSeenAt: 1,
            serverVersion: '0.5.60',
            relays: [{ name: 'api', url: 'http://backend:3005' }],
          })
        : fetchImpl(url, init),
    );
    await updateSandboxDevice({}, deps);
    const config = await readSandboxDeviceConfig(sandboxDeviceConfigPath(home));
    expect(config?.relays).toEqual([
      { name: 'api', url: 'http://backend:3005' },
    ]);
    expect(rec.streamed[0]).toContain(
      'ghcr.io/tale-project/tale/tale-sandbox:0.5.60',
    );
  });

  test('disconnect asks first, and a "no" changes nothing', async () => {
    const { deps, home, rec } = await connected();
    deps.confirm = mock(async () => false);
    await disconnectSandboxDevice({ keepData: false, force: false }, deps);
    expect(rec.requests.some((r) => r.method === 'DELETE')).toBe(false);
    expect(
      await readSandboxDeviceConfig(sandboxDeviceConfigPath(home)),
    ).not.toBeNull();
  });
});

describe('deviceNameFrom', () => {
  test.each([
    ['studio-mac.local', 'studio-mac'],
    ['Build Box', 'Build-Box'],
    ['', 'tale-device'],
  ])('%p → %p', (hostname, name) => {
    expect(deviceNameFrom(hostname)).toBe(name);
  });
});
