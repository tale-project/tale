import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  engineJson,
  type EngineStub,
  startEngineStub,
} from './docker-engine-stub.ts';
import {
  containerInspect,
  containerListing,
  ENGINE_API_VERSION,
  engineSocket,
  forgetEngineVersions,
  jsonString,
  type ContainerFormat,
} from './docker-engine.ts';
import { isDockerNoSuchObject, runDocker } from './spawn-util.ts';

const ENV_KEYS = ['DOCKER_BIN', 'DOCKER_HOST', 'DOCKER_CONTEXT'] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Point the spawner at the stub alone: the Engine API answers. */
function useStub(stub: EngineStub): void {
  delete process.env.DOCKER_BIN;
  delete process.env.DOCKER_CONTEXT;
  process.env.DOCKER_HOST = `unix://${stub.socket}`;
}

const RUNNING: ContainerFormat = {
  template: '{{.State.Running}}',
  render: (c) => String(c.running),
};

function container(overrides: Record<string, unknown> = {}) {
  return {
    Id: 'a'.repeat(64),
    Created: '2026-10-30T07:22:23.576123456Z',
    State: { Status: 'running', Running: true, OOMKilled: false },
    Config: { Labels: { 'tale.created': '1700000000000' } },
    Mounts: [],
    ...overrides,
  };
}

describe('engineSocket: the Engine API answers only where the CLI target is a certain local socket', () => {
  test.each([
    [{ DOCKER_HOST: 'unix:///var/run/docker.sock' }, '/var/run/docker.sock'],
    [
      { DOCKER_HOST: 'unix:///run/user/1000/docker.sock' },
      '/run/user/1000/docker.sock',
    ],
    // An empty context is no context, as the CLI reads DOCKER_CONTEXT.
    [{ DOCKER_HOST: 'unix:///x.sock', DOCKER_CONTEXT: '' }, '/x.sock'],
  ])('%j answers from %s', (env, socket) => {
    expect(engineSocket(env)).toBe(socket);
  });

  test.each([
    // The CLI resolves its own context and configuration.
    [{}],
    [{ DOCKER_HOST: '' }],
    // Remote daemons.
    [{ DOCKER_HOST: 'tcp://10.0.0.5:2376' }],
    [{ DOCKER_HOST: 'ssh://deploy@build-host' }],
    [{ DOCKER_HOST: 'npipe:////./pipe/docker_engine' }],
    [{ DOCKER_HOST: 'unix://docker.sock' }],
    // Another CLI (the isolated test CLI), even with a local socket named.
    [{ DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_BIN: '/tmp/docker' }],
    [{ DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_BIN: '' }],
    // A context of the CLI's own.
    [{ DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONTEXT: 'remote' }],
  ])('%j keeps the CLI', (env) => {
    expect(engineSocket(env)).toBeNull();
  });
});

describe('the read arguments the CLI gets', () => {
  test('an inspect is `docker inspect --format <template> <ref>`', () => {
    expect(containerInspect('tale-sbx-ses-a', RUNNING).args).toEqual([
      'inspect',
      '--format',
      '{{.State.Running}}',
      'tale-sbx-ses-a',
    ]);
  });

  test('a listing is `docker ps <options> --format <template>`', () => {
    const { args } = containerListing(
      ['--all', '--no-trunc', '--filter', 'label=tale.org=org_1'],
      { template: '{{.State}}', render: (c) => c.state },
    );
    expect(args).toEqual([
      'ps',
      '--all',
      '--no-trunc',
      '--filter',
      'label=tale.org=org_1',
      '--format',
      '{{.State}}',
    ]);
  });

  test.each([
    [['-q']],
    [['--last', '3']],
    [['--size']],
    [['--filter', 'dangling']],
  ])(
    'a listing option %j that would list or print otherwise has no Engine API read',
    (options) => {
      expect(() =>
        containerListing(options, {
          template: '{{.State}}',
          render: (c) => c.state,
        }),
      ).toThrow();
    },
  );
});

describe('runDocker answers a read from the Engine API', () => {
  let stub: EngineStub;
  let fakeRoot: string;

  beforeAll(async () => {
    stub = await startEngineStub();
    fakeRoot = await mkdtemp(join(tmpdir(), 'tale-engine-cli-'));
    const cli = join(fakeRoot, 'docker');
    await writeFile(cli, '#!/usr/bin/env bash\necho "cli: $*"\n');
    await chmod(cli, 0o755);
  });

  afterAll(async () => {
    restoreEnv();
    await stub.stop();
    await rm(fakeRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    forgetEngineVersions();
    stub.requests.length = 0;
    stub.containers.clear();
    stub.listing = [];
    stub.apiVersion = '1.47';
    stub.intercept = null;
    useStub(stub);
  });

  afterEach(restoreEnv);

  test('an inspect prints what its template prints, a line per container', async () => {
    stub.containers.set('tale-sbx-ses-a', container());
    const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
    const result = await runDocker(args, { engine });
    expect(result).toEqual({
      exitCode: 0,
      stdout: 'true\n',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    expect(stub.requests).toEqual([
      'HEAD /_ping',
      'GET /v1.47/containers/tale-sbx-ses-a/json',
    ]);
  });

  test('with DOCKER_BIN set the CLI answers, and the socket hears nothing', async () => {
    process.env.DOCKER_BIN = join(fakeRoot, 'docker');
    const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
    const result = await runDocker(args, { engine });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      'cli: inspect --format {{.State.Running}} tale-sbx-ses-a\n',
    );
    expect(stub.requests).toEqual([]);
  });

  test('a missing container is the daemon\'s "No such container", as the CLI reads it', async () => {
    const { args, engine } = containerInspect('tale-sbx-ses-gone', RUNNING);
    const result = await runDocker(args, { engine });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'Error response from daemon: No such container: tale-sbx-ses-gone',
    );
    expect(isDockerNoSuchObject(result.stderr)).toBe(true);
  });

  test('a route the daemon does not know is a failure, never a missing container', async () => {
    stub.intercept = (_request, path) =>
      path.endsWith('/json')
        ? engineJson({ message: 'page not found' }, 404)
        : undefined;
    const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
    const result = await runDocker(args, { engine });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Error response from daemon: page not found');
    expect(isDockerNoSuchObject(result.stderr)).toBe(false);
  });

  test.each([
    // The daemon's JSON error: its message.
    [
      () => engineJson({ message: ' driver failed \n' }, 500),
      'Error response from daemon: driver failed',
    ],
    // Anything not typed exactly application/json (a proxy, another
    // charset): its body, as the CLI prints it.
    [
      () => Response.json({ message: 'driver failed' }, { status: 500 }),
      'Error response from daemon: {"message":"driver failed"}',
    ],
    [
      () => new Response('Bad Gateway\n', { status: 502 }),
      'Error response from daemon: Bad Gateway',
    ],
    [
      () => new Response('', { status: 503 }),
      'request returned Service Unavailable for API route and version http://localhost/v1.47/containers/tale-sbx-ses-a/json, check if the server supports the requested API version',
    ],
  ])(
    'a refusal reads as the error the CLI prints (%#)',
    async (respond, said) => {
      stub.intercept = (_request, path) =>
        path.endsWith('/json') ? respond() : undefined;
      const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
      const result = await runDocker(args, { engine });
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(said);
      expect(isDockerNoSuchObject(result.stderr)).toBe(false);
    },
  );

  test('a redirect fails the read: nothing on the socket sends it elsewhere', async () => {
    stub.intercept = (_request, path) =>
      path.endsWith('/json')
        ? new Response(null, {
            status: 307,
            headers: { Location: 'http://example.com/containers/x/json' },
          })
        : undefined;
    const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
    const result = await runDocker(args, { engine });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('error during connect');
    expect(stub.requests).toHaveLength(2);
  });

  test('a missing socket fails the read as the CLI fails it: unknown, not gone', async () => {
    process.env.DOCKER_HOST = `unix://${join(fakeRoot, 'absent.sock')}`;
    const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
    const result = await runDocker(args, { engine });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toStartWith(
      `docker inspect: error during connect to the Docker daemon at unix://${join(fakeRoot, 'absent.sock')}: `,
    );
    expect(isDockerNoSuchObject(result.stderr)).toBe(false);
  });

  test('no answer within the budget is exit 124, as a CLI the timer killed', async () => {
    stub.intercept = async (_request, path) => {
      if (!path.endsWith('/json')) return undefined;
      await Bun.sleep(2_000);
      return engineJson(container());
    };
    const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
    const startedAt = Date.now();
    const result = await runDocker(args, { engine, timeoutMs: 100 });
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(result.exitCode).toBe(124);
    expect(result.stdout).toBe('');
  });

  test('a cancelled read is exit -1, before or during its request', async () => {
    stub.containers.set('tale-sbx-ses-a', container());
    const { args, engine } = containerInspect('tale-sbx-ses-a', RUNNING);
    const before = await runDocker(args, {
      engine,
      signal: AbortSignal.abort(),
    });
    expect(before.exitCode).toBe(-1);
    expect(stub.requests).toEqual([]);

    stub.intercept = async (_request, path) => {
      if (!path.endsWith('/json')) return undefined;
      await Bun.sleep(2_000);
      return engineJson(container());
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('stop')), 50);
    const during = await runDocker(args, {
      engine,
      signal: controller.signal,
    });
    expect(during.exitCode).toBe(-1);
  });

  test('stdoutMaxBytes caps the rendered output as it caps the CLI output', async () => {
    stub.listing = Array.from({ length: 5 }, () => ({
      State: 'running',
      Labels: { 'tale.org': 'org_0123456789' },
    }));
    const { args, engine } = containerListing(['--all'], {
      template: '{{.Label "tale.org"}}',
      render: (c) => c.label('tale.org'),
    });
    const result = await runDocker(args, { engine, stdoutMaxBytes: 20 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('org_0123456789\norg_0');
    expect(result.stdoutTruncated).toBe(true);
  });

  test('an answer past 16 MiB fails the read instead of filling the heap', async () => {
    stub.intercept = (_request, path) =>
      path.endsWith('/containers/json')
        ? new Response(`[${'"x",'.repeat(4 * 1024 * 1024)}"x"]`)
        : undefined;
    const { args, engine } = containerListing(['--all'], {
      template: '{{.State}}',
      render: (c) => c.state,
    });
    const result = await runDocker(args, { engine });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('exceeds');
  });

  test('an answer the template cannot be printed from fails the read, as it fails the CLI', async () => {
    // The CLI decodes State into a pointer: a template below an absent one
    // fails there, and a field of another type fails its decoding.
    stub.containers.set('no-state', container({ State: null }));
    stub.containers.set('odd-state', container({ State: { Running: 'yes' } }));
    for (const ref of ['no-state', 'odd-state']) {
      const { args, engine } = containerInspect(ref, RUNNING);
      const result = await runDocker(args, { engine });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unreadable Docker Engine API answer');
    }
  });

  test('a listing asks with the same --all and filters the CLI gets, a line per container', async () => {
    stub.listing = [
      {
        State: 'running',
        Labels: { 'tale.sandbox-session': '1', 'tale.org': 'org_a' },
      },
      {
        State: 'exited',
        Labels: { 'tale.sandbox-session': '1', 'tale.org': 'org_b' },
      },
      { State: 'running', Labels: { 'tale.org': 'org_c' } },
      { State: 'running', Labels: null },
    ];
    const format = {
      template: '{{.State}} {{.Label "tale.org"}}',
      render: (c: { state: string; label(name: string): string }) =>
        `${c.state} ${c.label('tale.org')}`,
    };
    const all = containerListing(
      ['--all', '--filter', 'label=tale.sandbox-session=1'],
      format,
    );
    const listed = await runDocker(all.args, { engine: all.engine });
    expect(listed.stdout).toBe('running org_a\nexited org_b\n');
    const running = containerListing(
      ['-f', 'label=tale.sandbox-session=1', '-f', 'label=tale.org=org_a'],
      format,
    );
    expect(
      (await runDocker(running.args, { engine: running.engine })).stdout,
    ).toBe('running org_a\n');
    expect(stub.requests.slice(1)).toEqual([
      'GET /v1.47/containers/json?all=1&filters={"label":["tale.sandbox-session=1"]}',
      'GET /v1.47/containers/json?filters={"label":["tale.sandbox-session=1","tale.org=org_a"]}',
    ]);
    stub.listing = [];
    expect((await runDocker(all.args, { engine: all.engine })).stdout).toBe('');
  });

  test('a container name is a path segment of its own', async () => {
    const { args, engine } = containerInspect('a/b?c', RUNNING);
    await runDocker(args, { engine });
    expect(stub.requests.at(-1)).toBe('GET /v1.47/containers/a%2Fb%3Fc/json');
    expect(engine.path).toBe('/containers/a%2Fb%3Fc/json');
  });
});

describe('the API version a read asks in', () => {
  let stub: EngineStub;

  beforeAll(async () => {
    stub = await startEngineStub();
  });

  afterAll(async () => {
    restoreEnv();
    await stub.stop();
  });

  beforeEach(() => {
    forgetEngineVersions();
    stub.requests.length = 0;
    stub.intercept = null;
    stub.apiVersion = '1.47';
    stub.containers.set('a', container());
    useStub(stub);
  });

  afterEach(restoreEnv);

  async function readOnce(): Promise<void> {
    const { args, engine } = containerInspect('a', RUNNING);
    await runDocker(args, { engine });
  }

  test.each([
    ['1.43', '1.43'],
    ['1.47', '1.47'],
    // A newer daemon is asked in the version the image's CLI speaks.
    ['1.52', ENGINE_API_VERSION],
    ['2.0', ENGINE_API_VERSION],
    // A daemon that names none is taken for 1.24, as the CLI takes it.
    [null, '1.24'],
    ['unversioned', '1.24'],
  ])(
    'a daemon naming %p is asked in %s, once negotiated',
    async (named, asked) => {
      stub.apiVersion = named;
      await readOnce();
      await readOnce();
      expect(stub.requests).toEqual([
        'HEAD /_ping',
        `GET /v${asked}/containers/a/json`,
        `GET /v${asked}/containers/a/json`,
      ]);
    },
  );

  /** The daemon refuses every version but `takes`, naming it as `named`. */
  function refuseAllBut(takes: string, named: (asked: string) => string) {
    stub.intercept = (_request, path) => {
      const asked = /^\/v(\d+\.\d+)\//.exec(path)?.[1];
      return asked === undefined || asked === takes
        ? undefined
        : engineJson({ message: named(asked) }, 400);
    };
  }

  test.each([
    // A daemon replaced by an older one.
    [
      '1.45',
      (asked: string) =>
        `client version ${asked} is too new. Maximum supported API version is 1.45`,
    ],
    // A daemon that outgrew the CLI the image ships.
    [
      '1.50',
      (asked: string) =>
        `client version ${asked} is too old. Minimum supported API version is 1.50, please upgrade your client to a newer version`,
    ],
  ])(
    'a refused version is replaced on the same read by the %s the daemon names, and kept',
    async (takes, named) => {
      await readOnce();
      refuseAllBut(takes, named);
      const { args, engine } = containerInspect('a', RUNNING);
      const read = await runDocker(args, { engine });
      expect(read.exitCode).toBe(0);
      expect(read.stdout).toBe('true\n');
      await readOnce();
      expect(stub.requests).toEqual([
        'HEAD /_ping',
        'GET /v1.47/containers/a/json',
        'GET /v1.47/containers/a/json',
        `GET /v${takes}/containers/a/json`,
        `GET /v${takes}/containers/a/json`,
      ]);
    },
  );

  test('a daemon that refuses the version it named too fails the read, after one retry', async () => {
    refuseAllBut('none', (asked) =>
      asked === '1.47'
        ? 'client version 1.47 is too old. Minimum supported API version is 1.50'
        : `client version ${asked} is too old. Minimum supported API version is 1.51`,
    );
    const { args, engine } = containerInspect('a', RUNNING);
    const read = await runDocker(args, { engine });
    expect(read.exitCode).toBe(1);
    expect(read.stderr).toBe(
      'Error response from daemon: client version 1.50 is too old. Minimum supported API version is 1.51',
    );
    expect(stub.requests).toEqual([
      'HEAD /_ping',
      'GET /v1.47/containers/a/json',
      'GET /v1.50/containers/a/json',
    ]);
  });
});

describe('what a template reads of the API answer', () => {
  test('absent labels, mounts and flags read as the CLI prints their zero values', async () => {
    const stub = await startEngineStub();
    try {
      useStub(stub);
      forgetEngineVersions();
      stub.containers.set(
        'bare',
        container({ Config: { Labels: null }, Mounts: null, State: {} }),
      );
      const { args, engine } = containerInspect('bare', {
        template: 'unused by the Engine API',
        render: (c) =>
          `${c.running}|${c.oomKilled}|${c.status}|${c.label('tale.created')}|${c.mounts.length}`,
      });
      expect((await runDocker(args, { engine })).stdout).toBe(
        'false|false|||0\n',
      );
    } finally {
      restoreEnv();
      await stub.stop();
    }
  });

  test('{{json}} of a string writes what the CLI writes: <, > and & as they are, the line separators escaped', () => {
    expect(jsonString('a<b>&c\u2028d\u2029"\\\n')).toBe(
      '"a<b>&c\\u2028d\\u2029\\"\\\\\\n"',
    );
  });
});
