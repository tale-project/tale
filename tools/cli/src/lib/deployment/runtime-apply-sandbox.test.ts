import {
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from 'bun:test';
import {
  chmodSync,
  chownSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import * as logger from '../../utils/logger';
import { applyRuntime, observeReadyRuntime } from './runtime-apply';
import { ConfigurationDockerFixture } from './runtime-configuration-fixture';
import { parseRuntimeEnvironment } from './runtime-env';
import {
  readRuntimeBundle,
  type ApplyRuntimeOptions,
  type ComposeDocument,
} from './runtime-model';
import { prepareRuntime } from './runtime-prepare';
import {
  SANDBOX_INCUS_FILES,
  SANDBOX_OWNED_VARIABLES,
  type SandboxShape,
} from './runtime-sandbox';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

// Tests here build the git runtime fixture (four git spawns per build);
// Windows CI runners stall on git for seconds at a time, and the 5 s
// default killed a passing test mid-commit.
setDefaultTimeout(30_000);

// The Incus shape needs a POSIX host: its credentials are checked by mode and
// owner, and the managed commands are not offered on Windows.
const describePosix = describe.skipIf(process.platform === 'win32');

const DECLARED = {
  address: '10.200.50.2',
  egressProxy: 'http://10.200.40.10:3128',
};

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});

interface Mount {
  Type: string;
  Name?: string;
  Source: string;
  Destination: string;
  RW: boolean;
}

/** One release source prepared into both shapes, to apply to one state
 * directory. */
async function create(shapes: readonly SandboxShape[] = ['docker', 'incus']) {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  // The credential check refuses a state directory below a link, and the
  // system temporary directory is one on macOS.
  const root = realpathSync(fixture.directory);
  fixture.options.stateDirectory = join(root, 'state');
  const docker = new RuntimeDockerFixture(fixture);
  const configuration = new ConfigurationDockerFixture(docker);
  const bundles: Record<SandboxShape, string> = {
    docker: join(root, 'bundle-docker'),
    incus: join(root, 'bundle-incus'),
  };
  for (const shape of shapes)
    await prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: bundles[shape],
        platform: 'linux/amd64',
        ...(shape === 'incus' ? { sandbox: DECLARED } : {}),
      },
      docker.dependencies(),
    );
  docker.calls = [];
  const credentials = join(fixture.options.stateDirectory, 'sandbox-incus');
  const place = () => {
    mkdirSync(credentials, { recursive: true, mode: 0o700 });
    chmodSync(credentials, 0o700);
    for (const name of SANDBOX_INCUS_FILES)
      writeFileSync(join(credentials, name), `${name} fixture bytes\n`, {
        mode: 0o600,
      });
  };
  const workspaces = { created: 0 };
  const dependencies = () => ({
    ...configuration.dependencies(),
    ensureSandboxWorkspace: () => {
      workspaces.created += 1;
    },
  });
  const apply = (
    shape: SandboxShape,
    options: Partial<ApplyRuntimeOptions> = {},
  ) =>
    applyRuntime(
      { ...fixture.options, bundleDirectory: bundles[shape], ...options },
      dependencies(),
    );
  const observe = (shape: SandboxShape) =>
    observeReadyRuntime(
      { ...fixture.options, bundleDirectory: bundles[shape] },
      docker.dependencies(),
    );
  const state = (file: string) => join(fixture.options.stateDirectory, file);
  const receipt = () =>
    JSON.parse(readFileSync(state('.tale/runtime.json'), 'utf8')) as {
      phase: string;
      bundleSha256: string;
    };
  return {
    fixture,
    docker,
    configuration,
    bundles,
    credentials,
    place,
    workspaces,
    apply,
    observe,
    state,
    receipt,
    sandbox: () =>
      docker.containers.find(
        (container) =>
          (container.Config as { Labels: Record<string, string> }).Labels[
            'com.docker.compose.service'
          ] === 'sandbox',
      )!,
    mountsOf: (service: string) =>
      (
        docker.containers.find(
          (container) =>
            (container.Config as { Labels: Record<string, string> }).Labels[
              'com.docker.compose.service'
            ] === service,
        )!.Mounts as Mount[]
      ).map(({ Type, Source, Destination, RW }) => ({
        Type,
        Source,
        Destination,
        RW,
      })),
    mutate: (service: string, edit: (mounts: Mount[]) => Mount[]) => {
      const container = docker.containers.find(
        (candidate) =>
          (candidate.Config as { Labels: Record<string, string> }).Labels[
            'com.docker.compose.service'
          ] === service,
      )!;
      container.Mounts = edit(container.Mounts as Mount[]);
    },
  };
}
type Run = Awaited<ReturnType<typeof create>>;

const SOCKET: Mount = {
  Type: 'bind',
  Source: '/var/run/docker.sock',
  Destination: '/var/run/docker.sock',
  RW: true,
};
const ROOT: Mount = {
  Type: 'bind',
  Source: '/var/lib/tale-sandbox',
  Destination: '/var/lib/tale-sandbox',
  RW: true,
};
const incusMount = (run: Run): Mount => ({
  Type: 'bind',
  Source: run.credentials,
  Destination: '/run/secrets/incus',
  RW: false,
});
const EXTRA: Mount = {
  Type: 'bind',
  Source: '/etc',
  Destination: '/host-etc',
  RW: true,
};

/** The credential directory broken in each way the check refuses. */
const BREAKS: [string, (run: Run) => void][] = [
  [
    'a missing directory',
    (run) => rmSync(run.credentials, { recursive: true }),
  ],
  [
    'a directory that is a link',
    (run) => {
      const real = `${run.credentials}-real`;
      renameSync(run.credentials, real);
      symlinkSync(real, run.credentials);
    },
  ],
  [
    'a directory that is a file',
    (run) => {
      rmSync(run.credentials, { recursive: true });
      writeFileSync(run.credentials, 'not a directory', { mode: 0o600 });
    },
  ],
  ['a directory open to the group', (run) => chmodSync(run.credentials, 0o750)],
  ['a directory open to others', (run) => chmodSync(run.credentials, 0o705)],
  [
    'an ancestor that others can write',
    (run) => chmodSync(run.fixture.options.stateDirectory, 0o777),
  ],
  ['a missing file', (run) => rmSync(join(run.credentials, 'server.crt'))],
  [
    'a file that is a link',
    (run) => {
      const target = join(run.credentials, 'target');
      writeFileSync(target, 'bytes', { mode: 0o600 });
      rmSync(join(run.credentials, 'client.key'));
      symlinkSync(target, join(run.credentials, 'client.key'));
    },
  ],
  [
    'a file readable by the group',
    (run) => chmodSync(join(run.credentials, 'client.key'), 0o640),
  ],
  [
    'a file readable by others',
    (run) => chmodSync(join(run.credentials, 'client.crt'), 0o604),
  ],
  [
    'a file with a second hard link',
    (run) =>
      linkSync(
        join(run.credentials, 'client.key'),
        join(run.fixture.directory, 'second-link'),
      ),
  ],
  [
    'an empty file',
    (run) => writeFileSync(join(run.credentials, 'server.crt'), ''),
  ],
  [
    'a file over the runtime input limit',
    (run) => truncateSync(join(run.credentials, 'server.crt'), 2_000_001),
  ],
  ...(process.getuid?.() === 0
    ? [
        [
          'a file owned by another account',
          (run: Run) =>
            chownSync(join(run.credentials, 'client.key'), 54321, 54321),
        ] as [string, (run: Run) => void],
      ]
    : []),
];

describePosix('applying the Incus shape of the sandbox service', () => {
  test.each(BREAKS)(
    'refuses %s before Docker is touched, in a real apply and in a dry run',
    async (_, damage) => {
      const run = await create(['incus']);
      run.place();
      damage(run);
      for (const dryRun of [false, true]) {
        await expect(run.apply('incus', { dryRun })).rejects.toThrow(
          'Incus sandbox credential',
        );
        expect(run.docker.calls).toEqual([]);
      }
    },
  );

  test('accepts the directory of three private files, in a dry run and in an apply', async () => {
    const run = await create(['incus']);
    run.place();
    expect(await run.apply('incus', { dryRun: true })).toMatchObject({
      dryRun: true,
      changed: true,
    });
    expect(await run.apply('incus')).toMatchObject({
      dryRun: false,
      changed: true,
    });
    expect(run.receipt().phase).toBe('ready');
  });

  test('refuses to apply the shape on a host that has no POSIX account ids, before Docker is touched', async () => {
    const run = await create(['incus']);
    run.place();
    const account = process.getuid;
    const host = process as { getuid?: typeof account };
    host.getuid = undefined;
    try {
      await expect(run.apply('incus')).rejects.toThrow('needs a POSIX host');
    } finally {
      host.getuid = account;
    }
    expect(run.docker.calls).toEqual([]);
  });

  test('creates the host workspace of sessions for the Docker shape and never for the Incus shape', async () => {
    const docker = await create(['docker']);
    await docker.apply('docker');
    expect(docker.workspaces.created).toBe(1);
    const incus = await create(['incus']);
    incus.place();
    await incus.apply('incus');
    expect(incus.workspaces.created).toBe(0);
  });

  test('lets a fresh runtime hold the credentials directory and still refuses any other entry', async () => {
    const run = await create();
    run.place();
    mkdirSync(run.state('stranger'));
    await expect(run.apply('incus')).rejects.toThrow('Unrecognized existing');
    rmSync(run.state('stranger'), { recursive: true });
    await run.apply('incus');
    expect(readdirSync(run.fixture.options.stateDirectory).sort()).toEqual([
      '.tale',
      'sandbox-incus',
      'secrets.env',
      'src',
    ]);
  });

  test('does not let a fresh Docker runtime hold the credentials directory', async () => {
    const run = await create();
    run.place();
    await expect(run.apply('docker')).rejects.toThrow('Unrecognized existing');
    expect(run.docker.calls.some(({ args }) => args.includes('up'))).toBe(
      false,
    );
  });

  test.each([...SANDBOX_OWNED_VARIABLES])(
    'refuses an environment that names %s, which the shape sets itself, before Docker is touched',
    async (name) => {
      const run = await create(['incus']);
      run.place();
      await expect(
        run.apply('incus', { environment: { [name]: 'declared' } }),
      ).rejects.toThrow('sets itself');
      expect(run.docker.calls).toEqual([]);
    },
  );

  test('mounts the credentials read-only from the state directory and nothing of the host Docker', async () => {
    const run = await create(['incus']);
    run.place();
    await run.apply('incus');
    expect(run.mountsOf('sandbox')).toEqual([
      {
        Type: 'bind',
        Source: run.credentials,
        Destination: '/run/secrets/incus',
        RW: false,
      },
      {
        Type: 'volume',
        Source: '/var/lib/docker/volumes/tale_config-data/_data',
        Destination: '/app/platform-config',
        RW: false,
      },
    ]);
    const bundle = readRuntimeBundle(run.bundles.incus);
    expect(run.receipt().bundleSha256).toBe(bundle.identity);
    expect(await run.observe('incus')).toMatchObject({
      revision: run.fixture.revision,
    });
  });
});

describePosix(
  'switching the sandbox service between its shapes in place',
  () => {
    const composeOf = (run: Run) =>
      parse(
        readFileSync(run.state('src/compose.yml'), 'utf8'),
      ) as ComposeDocument;
    const bundleOf = (run: Run, shape: SandboxShape) =>
      readRuntimeBundle(run.bundles[shape]);

    test('moves a running Docker runtime to the Incus shape and back, checking the mounts of each shape exactly after the start', async () => {
      const run = await create();
      await run.apply('docker');
      const dockerMounts = run.mountsOf('sandbox');
      run.place();
      run.docker.calls = [];
      const toIncus = await run.apply('incus');
      expect(toIncus).toMatchObject({ changed: true, existing: true });
      expect(
        run.docker.calls.filter(({ args }) => args.includes('up')),
      ).toHaveLength(1);
      expect(run.mountsOf('sandbox').map((mount) => mount.Destination)).toEqual(
        ['/run/secrets/incus', '/app/platform-config'],
      );
      expect(run.receipt()).toMatchObject({
        phase: 'ready',
        bundleSha256: bundleOf(run, 'incus').identity,
      });
      expect(composeOf(run).services.sandbox.volumes).toEqual([
        '../sandbox-incus:/run/secrets/incus:ro',
        'config-data:/app/platform-config:ro',
      ]);
      run.docker.calls = [];
      const toDocker = await run.apply('docker');
      expect(toDocker).toMatchObject({ changed: true, existing: true });
      expect(run.mountsOf('sandbox')).toEqual(dockerMounts);
      expect(run.receipt().bundleSha256).toBe(bundleOf(run, 'docker').identity);
      // The Docker shape creates the host workspace again; the credentials
      // directory stays for the deployment automation to remove.
      expect(run.workspaces.created).toBe(2);
      expect(readdirSync(run.credentials).sort()).toEqual([
        'client.crt',
        'client.key',
        'server.crt',
      ]);
    });

    test('previews the switch without changing anything', async () => {
      const run = await create();
      await run.apply('docker');
      run.place();
      const before = structuredClone(run.docker.containers);
      run.docker.calls = [];
      expect(await run.apply('incus', { dryRun: true })).toMatchObject({
        changed: true,
        dryRun: true,
      });
      expect(
        run.docker.calls.filter(
          ({ args }) =>
            args[0] === 'pull' ||
            args[0] === 'tag' ||
            (args[0] === 'network' && args[1] === 'create') ||
            args.includes('up'),
        ),
      ).toEqual([]);
      expect(run.docker.containers).toEqual(before);
    });

    test('accepts the other shape at admission only: after the start the mounts must be those of the bundle', async () => {
      const run = await create();
      await run.apply('docker');
      run.place();
      const dockerMounts = structuredClone(run.sandbox().Mounts) as Mount[];
      // A start that leaves the Docker mounts in place is not the Incus shape.
      run.docker.onUp = () =>
        run.mutate('sandbox', () => structuredClone(dockerMounts));
      await expect(run.apply('incus')).rejects.toThrow('host-mount identity');
      expect(run.receipt().phase).toBe('pending');
      // The retry of the same bundle admits the Docker mounts the container
      // still has, and a start that follows the bundle completes the switch.
      run.docker.onUp = null;
      expect(await run.apply('incus')).toMatchObject({ changed: true });
      expect(run.receipt().phase).toBe('ready');
      expect(run.mountsOf('sandbox').map((mount) => mount.Destination)).toEqual(
        ['/run/secrets/incus', '/app/platform-config'],
      );
    });

    test('refuses a ready runtime whose container has drifted to the other shape', async () => {
      const run = await create();
      await run.apply('docker');
      run.place();
      run.mutate('sandbox', (mounts) => [
        incusMount(run),
        mounts.find((mount) => mount.Destination === '/app/platform-config')!,
      ]);
      run.docker.calls = [];
      await expect(run.apply('docker')).rejects.toThrow('host-mount identity');
      await expect(run.observe('docker')).rejects.toThrow(
        'host-mount identity',
      );
      expect(run.docker.calls.some(({ args }) => args.includes('up'))).toBe(
        false,
      );
    });

    test('refuses a sandbox container that mixes the two shapes', async () => {
      const run = await create();
      await run.apply('docker');
      run.place();
      run.mutate('sandbox', (mounts) => [...mounts, incusMount(run)]);
      await expect(run.apply('incus')).rejects.toThrow('host-mount identity');
    });

    test('refuses an extra mount on a container of the other shape, in both directions', async () => {
      const run = await create();
      await run.apply('docker');
      run.place();
      run.mutate('sandbox', (mounts) => [...mounts, EXTRA]);
      await expect(run.apply('incus')).rejects.toThrow('host-mount identity');
      run.mutate('sandbox', (mounts) =>
        mounts.filter((mount) => mount !== EXTRA),
      );
      await run.apply('incus');
      run.mutate('sandbox', (mounts) => [...mounts, EXTRA]);
      await expect(run.apply('docker')).rejects.toThrow('host-mount identity');
      run.mutate('sandbox', (mounts) =>
        mounts.filter((mount) => mount !== EXTRA),
      );
      expect(await run.apply('docker')).toMatchObject({ changed: true });
    });

    test('refuses a container of the other shape that lacks its config volume', async () => {
      const run = await create();
      await run.apply('docker');
      run.place();
      run.mutate('sandbox', () => [SOCKET, ROOT]);
      await expect(run.apply('incus')).rejects.toThrow('host-mount identity');
    });

    test('refuses the credentials mount on any service but the sandbox', async () => {
      const run = await create();
      await run.apply('docker');
      run.place();
      run.mutate('db', (mounts) => [...mounts, incusMount(run)]);
      await expect(run.apply('incus')).rejects.toThrow('host-mount identity');
      await expect(run.apply('docker')).rejects.toThrow('host-mount identity');
    });

    test('a Docker bundle still refuses every extra mount it did not hold before', async () => {
      const run = await create();
      await run.apply('docker');
      run.mutate('sandbox', (mounts) => [...mounts, EXTRA]);
      await expect(
        run.apply('docker', {
          additionalOrigins: ['https://more.example.invalid'],
        }),
      ).rejects.toThrow('host-mount identity');
      run.mutate('sandbox', (mounts) =>
        mounts.filter((mount) => mount !== EXTRA),
      );
      run.mutate('sandbox', (mounts) => [...mounts, incusMount(run)]);
      await expect(
        run.apply('docker', {
          additionalOrigins: ['https://more.example.invalid'],
        }),
      ).rejects.toThrow('host-mount identity');
      // Without the extra mounts the same change is admitted.
      run.mutate('sandbox', (mounts) =>
        mounts.filter((mount) => mount.Destination !== '/run/secrets/incus'),
      );
      expect(
        await run.apply('docker', {
          additionalOrigins: ['https://more.example.invalid'],
        }),
      ).toMatchObject({ changed: true });
    });

    test('does not look at the credentials when it accepts the other shape for a Docker bundle', async () => {
      const run = await create();
      run.place();
      await run.apply('incus');
      // A rollback may find the directory already gone.
      rmSync(run.credentials, { recursive: true });
      expect(await run.apply('docker')).toMatchObject({ changed: true });
      expect(run.receipt().bundleSha256).toBe(bundleOf(run, 'docker').identity);
    });
  },
);

describePosix('the managed environment file across the sandbox shapes', () => {
  const environmentOf = (run: Run) =>
    parseRuntimeEnvironment(
      readFileSync(run.state('src/.env'), 'utf8'),
      'compose',
    );
  const egressOf = (run: Run) =>
    (
      parse(
        readFileSync(run.state('src/compose.yml'), 'utf8'),
      ) as ComposeDocument
    ).services.sandbox.environment as Record<string, string>;
  const DOCKER_DECLARED = {
    SANDBOX_RUNTIME: 'sysbox',
    SANDBOX_HUB_PORT: '8004',
    SANDBOX_MAX_SESSIONS: '32',
  };
  const INCUS_DECLARED = {
    SANDBOX_INCUS_ENDPOINT: 'https://10.200.60.2:8443',
    SANDBOX_INCUS_PROJECT: 'sandbox-example',
    SANDBOX_MAX_SESSIONS: '32',
  };

  test('holds no variable of the other shape after a switch in either direction, and each shape serves the egress proxy its bundle says', async () => {
    const run = await create();
    await run.apply('docker', { environment: DOCKER_DECLARED });
    expect(environmentOf(run)).toMatchObject(DOCKER_DECLARED);
    expect(egressOf(run).SANDBOX_EGRESS_PROXY).toBe(
      'http://sandbox-egress:3128',
    );

    run.place();
    await run.apply('incus', { environment: INCUS_DECLARED });
    const incus = environmentOf(run);
    expect(incus).toMatchObject(INCUS_DECLARED);
    for (const name of SANDBOX_OWNED_VARIABLES)
      expect(incus).not.toHaveProperty(name);
    expect(egressOf(run).SANDBOX_EGRESS_PROXY).toBe(DECLARED.egressProxy);
    expect(egressOf(run).SANDBOX_BACKEND).toBe('incus');

    await run.apply('docker', { environment: { SANDBOX_MAX_SESSIONS: '32' } });
    const docker = environmentOf(run);
    expect(docker).toMatchObject({ SANDBOX_MAX_SESSIONS: '32' });
    expect(docker).not.toHaveProperty('SANDBOX_BACKEND');
    expect(
      Object.keys(docker).some((name) => name.startsWith('SANDBOX_INCUS_')),
    ).toBe(false);
    expect(egressOf(run).SANDBOX_EGRESS_PROXY).toBe(
      'http://sandbox-egress:3128',
    );
    expect(egressOf(run)).not.toHaveProperty('SANDBOX_BACKEND');
  });
});

describePosix('draining the outgoing spawner before a backend switch', () => {
  const controls = (run: Run) =>
    run.docker.calls.filter(({ args }) =>
      args.includes('/app/src/control-cli.ts'),
    );
  const written = (run: Run) =>
    [
      'src/compose.yml',
      'src/.env',
      'src/Caddyfile.production',
      'secrets.env',
      '.tale/runtime.json',
    ].map((file) => readFileSync(run.state(file)));
  const pulls = (run: Run) =>
    run.docker.calls.filter(
      ({ args }) =>
        args[0] === 'pull' ||
        args[0] === 'tag' ||
        (args[0] === 'network' && args[1] === 'create') ||
        args.includes('up'),
    );
  async function running(shape: SandboxShape = 'docker') {
    const run = await create();
    // A fresh Docker runtime does not hold the credentials directory.
    if (shape === 'incus') run.place();
    await run.apply(shape);
    run.place();
    run.docker.calls = [];
    return run;
  }

  test('refuses while the outgoing spawner holds sessions, names their number and nothing else, and leaves the runtime as it was', async () => {
    const run = await running();
    run.configuration.sessions = ['session-secret-one', 'session-secret-two'];
    const before = written(run);
    let message = '';
    try {
      await run.apply('incus');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(
      'docker sandbox spawner still holds 2 session(s)',
    );
    expect(message).toContain('SANDBOX_SESSION_MAX_LINGER_MS');
    expect(message).toContain('apply the same bundle again');
    expect(message).toContain('Restarting the spawner lifts the drain');
    expect(message).not.toContain('session-secret');
    expect(run.configuration.draining).toBe(true);
    expect(pulls(run)).toEqual([]);
    expect(written(run)).toEqual(before);
  });

  test('refuses a spawner that is not running, which cannot say whether it holds sessions', async () => {
    const run = await running();
    (run.sandbox().State as { Running: boolean }).Running = false;
    const before = written(run);
    await expect(run.apply('incus')).rejects.toThrow(
      'docker sandbox spawner is not running',
    );
    expect(controls(run)).toEqual([]);
    expect(pulls(run)).toEqual([]);
    expect(written(run)).toEqual(before);
  });

  test('drains first and proceeds when no session is left, and a second attempt after a refusal finds the latch set', async () => {
    const run = await running();
    run.configuration.sessions = ['one'];
    await expect(run.apply('incus')).rejects.toThrow('still holds 1 session');
    expect(run.configuration.draining).toBe(true);
    // The spawner ended its sessions after its linger.
    run.configuration.sessions = [];
    run.docker.calls = [];
    expect(await run.apply('incus')).toMatchObject({ changed: true });
    const order = run.docker.calls.map(({ args }) =>
      args.includes('/app/src/control-cli.ts')
        ? `control ${args.at(-1)}`
        : args[0] === 'pull'
          ? 'pull'
          : args.includes('up')
            ? 'up'
            : '',
    );
    expect(order.indexOf('control drain')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('control drain')).toBeLessThan(order.indexOf('pull'));
    expect(order.indexOf('pull')).toBeLessThan(order.indexOf('up'));
    expect(run.receipt().phase).toBe('ready');
  });

  test('gates the switch back to Docker the same way and names the outgoing backend', async () => {
    const run = await running('incus');
    run.configuration.sessions = ['one', 'two', 'three'];
    const before = written(run);
    await expect(run.apply('docker')).rejects.toThrow(
      'incus sandbox spawner still holds 3 session(s)',
    );
    expect(written(run)).toEqual(before);
    run.configuration.sessions = [];
    expect(await run.apply('docker')).toMatchObject({ changed: true });
  });

  test('previews the drain in one line and reaches into no container', async () => {
    const run = await running();
    run.configuration.sessions = ['one'];
    const lines: string[] = [];
    const info = spyOn(logger, 'info').mockImplementation((message) => {
      lines.push(message);
    });
    try {
      expect(await run.apply('incus', { dryRun: true })).toMatchObject({
        changed: true,
        dryRun: true,
      });
    } finally {
      info.mockRestore();
    }
    expect(
      lines.filter((line) => line.includes('changes from docker to incus')),
    ).toHaveLength(1);
    expect(controls(run)).toEqual([]);
    expect(
      run.docker.calls.some(
        ({ args }) =>
          args[0] === 'exec' && args.includes(String(run.sandbox().Id)),
      ),
    ).toBe(false);
    expect(run.configuration.draining).toBe(false);
  });

  test('does not gate a first deploy, a replay of the ready bundle or a change inside one shape', async () => {
    const fresh = await create();
    fresh.place();
    await fresh.apply('incus');
    expect(controls(fresh)).toEqual([]);

    const run = await running();
    run.configuration.sessions = ['one'];
    expect(await run.apply('docker')).toMatchObject({ changed: false });
    expect(
      await run.apply('docker', {
        additionalOrigins: ['https://more.example.invalid'],
      }),
    ).toMatchObject({ changed: true });
    expect(controls(run)).toEqual([]);
    expect(run.configuration.draining).toBe(false);
  });
});
