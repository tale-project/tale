// The Docker session backend reading its containers from the Engine API: the
// same verdicts the CLI path gives (docker-session-backend.test.ts), from a
// stub daemon on a temporary socket, with no docker CLI process at all. Only
// the backend's reads are exercised here: its writes (run, stop, rm) keep the
// CLI, which this suite does not have.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  engineJson,
  type EngineStub,
  startEngineStub,
} from '../../docker-engine-stub.ts';
import { forgetEngineVersions } from '../../docker-engine.ts';
import { RUNNERD_PORT } from '../../session/runnerd-protocol.ts';
import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import { SessionIncarnationChangedError } from '../types.ts';
import { DockerSessionBackend } from './docker-session-backend.ts';

const STAMP = 1_700_000_000_000;
const ID = 'e'.repeat(64);

const ENV_KEYS = ['DOCKER_BIN', 'DOCKER_HOST', 'DOCKER_CONTEXT'] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

let stub: EngineStub;
let root = '';
let hostSessionRoot = '';

beforeAll(async () => {
  stub = await startEngineStub();
  root = await mkdtemp(join(tmpdir(), 'tale-session-engine-'));
});

afterAll(async () => {
  await stub.stop();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  forgetEngineVersions();
  stub.requests.length = 0;
  stub.containers.clear();
  stub.listing = [];
  stub.intercept = null;
  delete process.env.DOCKER_BIN;
  delete process.env.DOCKER_CONTEXT;
  process.env.DOCKER_HOST = `unix://${stub.socket}`;
  hostSessionRoot = await mkdtemp(join(root, 'sessions-'));
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function backend(overrides: Partial<SpawnerConfig> = {}): DockerSessionBackend {
  return new DockerSessionBackend({
    backend: 'docker',
    instance: '',
    hub: null,
    deviceConfigPath: null,
    port: 8003,
    sandboxToken: 'test-token',
    runtimeImage: 'tale-sandbox-runtime:test',
    runtimeTier: 'runc',
    dockerInContainer: false,
    dockerBuildCache: false,
    buildkitdImage: 'tale-sandbox-buildkitd:test',
    buildkitdMirrorImage: 'registry:2',
    transparentEgress: false,
    k8s: {
      namespace: 'tale-sandbox',
      runtimeClassName: null,
      workspaceSizeLimit: '4Gi',
    },
    maxTimeoutMs: 300_000,
    hostSessionRoot,
    cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
    egressNetwork: 'tale-sandbox-net',
    egressProxy: 'http://sandbox-egress:3128',
    stdoutMaxBytes: 5_242_880,
    stderrMaxBytes: 5_242_880,
    maxRequestBodyBytes: 262_144,
    session: TEST_SESSION_CONFIG,
    ...overrides,
  });
}

/** A session container's inspect document, as the daemon answers it. */
function session(
  state: { Status: string; Running: boolean; OOMKilled?: boolean },
  labels: Record<string, string> = { 'tale.created': String(STAMP) },
  extra: Record<string, unknown> = {},
) {
  return {
    Id: ID,
    Created: new Date().toISOString(),
    State: { OOMKilled: false, ...state },
    Config: { Labels: { 'tale.sandbox-session': '1', ...labels } },
    Mounts: [],
    ...extra,
  };
}

const RUNNING = { Status: 'running', Running: true };

/** The rejection of a promise, or null when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

describe('sessionExists from the Engine API', () => {
  test('checks the running state and the creation stamp in one request each, with no CLI', async () => {
    stub.containers.set('tale-sbx-ses-a', session(RUNNING));
    const docker = backend();
    expect(await docker.sessionExists('a', STAMP + 1)).toBe(false);
    expect(await docker.sessionExists('a', STAMP)).toBe(true);
    expect(await docker.sessionExists('a')).toBe(true);
    expect(stub.requests).toEqual([
      'HEAD /_ping',
      'GET /v1.47/containers/tale-sbx-ses-a/json',
      'GET /v1.47/containers/tale-sbx-ses-a/json',
      'GET /v1.47/containers/tale-sbx-ses-a/json',
    ]);
  });

  test.each([true, false])(
    'a stopped container the OOM killer hit (%p) is gone, and said so once',
    async (oomKilled) => {
      stub.containers.set(
        'tale-sbx-ses-died',
        session({ Status: 'exited', Running: false, OOMKilled: oomKilled }),
      );
      const docker = backend();
      expect(await docker.sessionExists('died', STAMP)).toBe(false);
      expect(docker.takeOutOfMemory('died', STAMP + 1)).toBe(false);
      await docker.sessionExists('died', STAMP);
      expect(docker.takeOutOfMemory('died', STAMP)).toBe(oomKilled);
      expect(docker.takeOutOfMemory('died', STAMP)).toBe(false);
    },
  );

  test.each(['', ' ', 'unreadable'])(
    'stamp %j cannot verify an incarnation',
    async (stamp) => {
      stub.containers.set(
        'tale-sbx-ses-odd',
        session(RUNNING, { 'tale.created': stamp }),
      );
      const docker = backend();
      expect(await rejection(docker.sessionExists('odd', 0))).toBeInstanceOf(
        Error,
      );
      expect(await rejection(docker.resolveEndpoint('odd', 0))).toBeInstanceOf(
        Error,
      );
      expect(await docker.sessionExists('odd')).toBe(true);
    },
  );

  test('a container the daemon does not have is gone, after one request', async () => {
    expect(await backend().sessionExists('gone', STAMP)).toBe(false);
    expect(stub.requests).toEqual([
      'HEAD /_ping',
      'GET /v1.47/containers/tale-sbx-ses-gone/json',
    ]);
  });

  test.each([
    ['a daemon error', () => engineJson({ message: 'driver failed' }, 500)],
    [
      'a route the daemon does not know',
      () => engineJson({ message: 'page not found' }, 404),
    ],
  ])(
    '%s is unknown: it throws, never reads as gone',
    async (_case, respond) => {
      stub.containers.set('tale-sbx-ses-a', session(RUNNING));
      stub.intercept = (_request, path) =>
        path.endsWith('/json') ? respond() : undefined;
      const error = await rejection(backend().sessionExists('a', STAMP));
      expect(error?.message).toStartWith(
        'docker inspect tale-sbx-ses-a failed',
      );
    },
  );

  test('a socket that is not there is unknown too', async () => {
    process.env.DOCKER_HOST = `unix://${join(root, 'absent.sock')}`;
    const error = await rejection(backend().sessionExists('a', STAMP));
    expect(error?.message).toContain('error during connect');
  });
});

describe('the incarnation fence from the Engine API', () => {
  test('resolveEndpoint adopts only the incarnation it was told of', async () => {
    stub.containers.set('tale-sbx-ses-a', session(RUNNING));
    const docker = backend();
    expect(await docker.resolveEndpoint('a', STAMP)).toBe(
      `http://tale-sbx-ses-a:${RUNNERD_PORT}`,
    );
    expect(
      await rejection(docker.resolveEndpoint('a', STAMP + 1)),
    ).toBeInstanceOf(SessionIncarnationChangedError);
  });

  test('a pin change refuses a replacement incarnation or a container that is gone', async () => {
    stub.containers.set('tale-sbx-ses-pinned', session(RUNNING));
    const docker = backend();
    await docker.setPinned('pinned', true, STAMP);
    const marker = join(hostSessionRoot, '.pins', 'pinned.pinned');
    expect((await stat(marker)).isFile()).toBe(true);
    const moved = await rejection(docker.setPinned('pinned', false, STAMP - 1));
    expect(moved?.message).toContain('container creation stamp moved');
    const gone = await rejection(docker.setPinned('elsewhere', true, STAMP));
    expect(gone).toBeInstanceOf(SessionIncarnationChangedError);
    expect(gone?.message).toContain('container is gone');
  });

  test('an identity the daemon cannot give is refused, not taken for gone', async () => {
    stub.intercept = (_request, path) =>
      path.endsWith('/json')
        ? engineJson({ message: 'driver failed' }, 500)
        : undefined;
    const error = await rejection(backend().setPinned('a', true, STAMP));
    expect(error?.message).toBe(
      'cannot identify session a for lifecycle transition',
    );
  });
});

describe('reapStaleSession from the Engine API', () => {
  const CREATED = { Status: 'created', Running: false };
  const NOW = Date.now();

  test.each([
    // [case, state, the container's stamp, the stamp the caller listed]
    ['a running session', RUNNING, STAMP, STAMP],
    ['a create still within its budget', CREATED, NOW, NOW],
    ['another incarnation', CREATED, STAMP + 1, STAMP],
  ])('leaves %s alone', async (_case, state, stamp, listed) => {
    stub.containers.set(
      'tale-sbx-ses-young',
      session(state, { 'tale.created': String(stamp) }),
    );
    expect(await backend().reapStaleSession('young', listed)).toBe(false);
  });

  test('a container already gone needs no reap', async () => {
    expect(await backend().reapStaleSession('gone', STAMP)).toBe(true);
  });

  test('a daemon error refuses the reap', async () => {
    stub.intercept = (_request, path) =>
      path.endsWith('/json')
        ? engineJson({ message: 'driver failed' }, 500)
        : undefined;
    expect(
      (await rejection(backend().reapStaleSession('a', STAMP)))?.message,
    ).toBe('cannot identify session a for lifecycle transition');
  });
});

describe('listSessions from the Engine API', () => {
  function listed(
    sessionId: string,
    labels: Record<string, string> = {},
    state = 'running',
  ) {
    return {
      Id: ID,
      State: state,
      Labels: {
        'tale.sandbox-session': '1',
        'tale.session': sessionId,
        'tale.org': 'org_fake',
        'tale.profile': 'agent',
        'tale.created': String(STAMP),
        ...labels,
      },
    };
  }

  test('reads each session container as the CLI path reads its line', async () => {
    stub.listing = [
      listed('dind', { 'tale.docker': 'true', 'tale.egress-ip': '172.30.0.3' }),
      listed('plain', {
        'tale.docker': 'false',
        'tale.egress-ip': 'sandbox-egress',
      }),
      listed('ended', { 'tale.profile': 'default' }, 'exited'),
      listed('elsewhere', { 'tale.sandbox-instance': 'device-7' }),
      { Id: ID, State: 'running', Labels: { 'tale.session': 'not-a-session' } },
    ];
    await mkdir(join(hostSessionRoot, '.pins'), { recursive: true });
    await writeFile(join(hostSessionRoot, '.pins', 'plain.pinned'), '1\n');
    const sessions = await backend().listSessions();
    const common = {
      organizationId: 'org_fake',
      createdAtMs: STAMP,
      ttlMs: TEST_SESSION_CONFIG.maxLifetimeMs,
      idleTimeoutMs: TEST_SESSION_CONFIG.maxIdleMs,
    };
    expect(sessions).toEqual([
      {
        ...common,
        sessionId: 'dind',
        profile: 'agent',
        docker: true,
        state: 'ready',
        pinned: false,
        ended: false,
        egressAddress: '172.30.0.3',
      },
      {
        ...common,
        sessionId: 'plain',
        profile: 'agent',
        docker: false,
        state: 'ready',
        pinned: true,
        ended: false,
      },
      {
        ...common,
        sessionId: 'ended',
        profile: 'default',
        state: 'degraded',
        pinned: false,
        ended: true,
      },
    ]);
    expect(stub.requests.at(-1)).toBe(
      'GET /v1.47/containers/json?all=1&filters={"label":["tale.sandbox-session=1"]}',
    );
  });

  test('asks the daemon for the instance and the organization the CLI filters by', async () => {
    stub.listing = [
      listed('mine', { 'tale.sandbox-instance': 'device-7' }),
      listed('theirs', {
        'tale.sandbox-instance': 'device-7',
        'tale.org': 'org_other',
      }),
      listed('deployment'),
    ];
    const sessions = await backend({ instance: 'device-7' }).listSessions(
      'org_fake',
    );
    expect(sessions.map((s) => s.sessionId)).toEqual(['mine']);
    expect(stub.requests.at(-1)).toBe(
      'GET /v1.47/containers/json?all=1&filters={"label":["tale.sandbox-session=1","tale.sandbox-instance=device-7","tale.org=org_fake"]}',
    );
  });

  test('THROWS when the listing fails instead of reporting "no sessions"', async () => {
    stub.intercept = (_request, path) =>
      path.endsWith('/containers/json')
        ? engineJson({ message: 'driver failed' }, 500)
        : undefined;
    const error = await rejection(backend().listSessions());
    expect(error?.message).toBe(
      'docker ps (sessions) failed (exit 1): Error response from daemon: driver failed',
    );
  });

  test('listWorkspaces joins the listing with the workspace directories', async () => {
    stub.listing = [listed('live'), listed('ended', {}, 'exited')];
    for (const id of ['live', 'ended', 'left']) {
      await mkdir(join(hostSessionRoot, `ses-${id}`));
    }
    const workspaces = await backend().listWorkspaces();
    expect(
      Object.fromEntries(workspaces.map((w) => [w.sessionId, w.active])),
    ).toEqual({ live: true, ended: false, left: false });
  });
});

describe('the workspace mount from the Engine API', () => {
  test('a session root moved since its container started is found through the container mount', async () => {
    // A colour subdirectory makes the flat path uncertain: the mount decides.
    await mkdir(join(hostSessionRoot, 'blue'));
    const moved = join(root, 'moved-root', 'ses-moved');
    await mkdir(moved, { recursive: true });
    stub.containers.set(
      'tale-sbx-ses-moved',
      session(RUNNING, undefined, {
        Mounts: [
          { Type: 'bind', Source: moved, Destination: '/agent' },
          { Type: 'tmpfs', Source: '', Destination: '/tmp' },
        ],
      }),
    );
    expect(await backend().hasWorkspace('moved')).toBe(true);
    expect(await backend().hasWorkspace('unmounted')).toBe(false);
  });
});
