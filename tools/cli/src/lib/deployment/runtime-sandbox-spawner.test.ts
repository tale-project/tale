import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { prepareRuntime } from './runtime-prepare';
import {
  INCUS_BACKEND_MARKER,
  SANDBOX_INCUS_MOUNT_POINT,
} from './runtime-sandbox';
import {
  commitRepositorySource,
  RuntimeDockerFixture,
  runtimeFixture,
  SPAWNER_CONFIG_SOURCE,
  type RuntimeFixture,
} from './runtime-test-helper';

// The preparation builds the git runtime fixture (four git spawns); Windows CI
// runners stall on git for seconds at a time, and the 5 s default killed a
// passing test mid-commit.
setDefaultTimeout(30_000);

const describePosix = describe.skipIf(process.platform === 'win32');

const REPOSITORY_ROOT = fileURLToPath(
  new URL('../../../../../', import.meta.url),
);
const SPAWNER_CONFIG = join(REPOSITORY_ROOT, SPAWNER_CONFIG_SOURCE[0]);

const DECLARED = {
  address: '10.200.50.2',
  egressProxy: 'http://10.200.40.10:3128',
};

/** What a representative specification adds beside the declaration: the Incus
 * objects of the node, the capacity, the sandbox bridge as the resolver of
 * sessions, and the token the spawner refuses to start without. */
const SPECIFICATION = {
  SANDBOX_INCUS_ENDPOINT: 'https://10.200.60.2:8443',
  SANDBOX_INCUS_PROJECT: 'sandbox-example',
  SANDBOX_INCUS_PROFILE: 'sandbox',
  SANDBOX_INCUS_NETWORK: 'sbx0',
  SANDBOX_INCUS_STORAGE_POOL: 'tank',
  SANDBOX_INCUS_DNS: '10.200.40.1',
  SANDBOX_MAX_SESSIONS: '256',
  SANDBOX_TOKEN: 'synthetic-token',
};

/** `${NAME}`, `${NAME:-default}` and `${NAME-default}`, as Compose resolves
 * them against the project's environment file. */
function interpolate(
  value: string,
  variables: Readonly<Record<string, string>>,
): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}/g,
    (_, name: string, operator?: string, fallback = '') => {
      const set = variables[name];
      if (set !== undefined && (operator !== ':-' || set !== '')) return set;
      return operator === undefined ? '' : fallback;
    },
  );
}

const fixtures: RuntimeFixture[] = [];
const scratch: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
  for (const directory of scratch.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/** The sandbox environment of the Incus bundle prepared from this repository's
 * own `compose.yml`, as the spawner container receives it. */
async function containerEnvironment() {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  commitRepositorySource(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  const bundle = await prepareRuntime(
    {
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: fixture.options.bundleDirectory,
      platform: 'linux/amd64',
      sandbox: DECLARED,
    },
    docker.dependencies(),
  );
  const compose = parse(
    readFileSync(join(fixture.options.bundleDirectory, 'compose.yml'), 'utf8'),
  ) as {
    services: { sandbox: { environment: Record<string, unknown> } };
  };
  const environment = Object.fromEntries(
    Object.entries(compose.services.sandbox.environment).map(
      ([name, value]) => [name, interpolate(String(value), SPECIFICATION)],
    ),
  );
  // Compose gives the container the environment file, and `environment:`
  // wins over it.
  const received: Record<string, string> = {
    ...SPECIFICATION,
    ...environment,
  };
  return { bundle, environment: received };
}

interface Loaded {
  ok: boolean;
  message?: string;
  warnings: string[];
  backend?: string;
  egressProxy?: string;
  incus?: {
    imageSource?: { server: string; alias: string };
    image: string;
    clientCertFile: string;
    clientKeyFile: string;
    serverCertFile: string;
  };
}

/** Run the spawner's own `loadConfig` over an environment in a process of its
 * own, so nothing from `services/sandbox` joins this workspace's type program
 * and the spawner reads exactly the environment it is given. */
function loadSpawnerConfiguration(environment: Record<string, string>): Loaded {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'tale-spawner-config-')),
  );
  scratch.push(directory);
  const script = `
    const warnings = [];
    console.warn = (...parts) => { warnings.push(parts.map(String).join(' ')); };
    const { loadConfig } = await import(process.env.TALE_SPAWNER_CONFIG_MODULE);
    try {
      const config = loadConfig();
      process.stdout.write(JSON.stringify({
        ok: true,
        warnings,
        backend: config.backend,
        egressProxy: config.egressProxy,
        incus: config.incus,
      }));
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false,
        warnings,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  `;
  const child = Bun.spawnSync([process.execPath, '-e', script], {
    cwd: REPOSITORY_ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: directory,
      TALE_PLATFORM_SHARED_CONFIG_DIR: directory,
      TALE_SPAWNER_CONFIG_MODULE: SPAWNER_CONFIG,
      ...environment,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  return JSON.parse(child.stdout.toString()) as Loaded;
}

describe('the modules the cross-check runs', () => {
  test('are the spawner files that load its configuration, and they exist', () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const transpiler = new Bun.Transpiler({ loader: 'ts' });
      for (const entry of transpiler.scanImports(readFileSync(file, 'utf8'))) {
        if (!entry.path.startsWith('.')) continue;
        const target = resolve(dirname(file), entry.path);
        const source = [target, `${target}.ts`, target.replace(/\.js$/, '.ts')]
          .filter((candidate) => candidate.endsWith('.ts'))
          .find((candidate) => existsSync(candidate));
        expect(source, `${entry.path} imported by ${file}`).toBeDefined();
        visit(source!);
      }
    };
    visit(SPAWNER_CONFIG);
    expect(
      [...seen]
        .map((file) => relative(REPOSITORY_ROOT, file).split('\\').join('/'))
        .sort(),
    ).toEqual([...SPAWNER_CONFIG_SOURCE].sort());
  });

  test('include the file whose presence tells a revision has the Incus backend', () => {
    expect(existsSync(join(REPOSITORY_ROOT, INCUS_BACKEND_MARKER))).toBe(true);
    expect(SPAWNER_CONFIG_SOURCE).toContain(INCUS_BACKEND_MARKER);
  });
});

describePosix(
  'the prepared Incus sandbox environment, run through the spawner',
  () => {
    test('boots the Incus backend with the declared proxy, the pinned image and the mounted credentials, saying nothing is ignored', async () => {
      const { bundle, environment } = await containerEnvironment();
      const loaded = loadSpawnerConfiguration(environment);
      expect(loaded.message).toBeUndefined();
      expect(loaded.ok).toBe(true);
      expect(loaded.backend).toBe('incus');
      expect(loaded.egressProxy).toBe(DECLARED.egressProxy);
      expect(
        loaded.warnings.filter((line) =>
          /has no effect|runtime tier/.test(line),
        ),
      ).toEqual([]);
      const incus = loaded.incus!;
      expect(incus.image).toBe(bundle.sandbox!.image.alias);
      expect(incus.imageSource).toEqual({
        server: 'https://ghcr.io',
        alias: bundle.sandbox!.image.source.slice('ghcr.io/'.length),
      });
      expect([
        incus.clientCertFile,
        incus.clientKeyFile,
        incus.serverCertFile,
      ]).toEqual([
        `${SANDBOX_INCUS_MOUNT_POINT}/client.crt`,
        `${SANDBOX_INCUS_MOUNT_POINT}/client.key`,
        `${SANDBOX_INCUS_MOUNT_POINT}/server.crt`,
      ]);
    });

    test.each([
      'SANDBOX_INCUS_IMAGE',
      'SANDBOX_INCUS_CLIENT_CERT_FILE',
      'SANDBOX_INCUS_CLIENT_KEY_FILE',
      'SANDBOX_INCUS_SERVER_CERT_FILE',
      'SANDBOX_EGRESS_PROXY',
    ])('refuses an environment that lacks %s, naming it', async (name) => {
      const { environment } = await containerEnvironment();
      delete environment[name];
      const loaded = loadSpawnerConfiguration(environment);
      expect(loaded.ok).toBe(false);
      expect(loaded.message).toContain(name);
    });

    test('is not the Incus backend without the variable that names it, and says its Incus settings are ignored', async () => {
      const { environment } = await containerEnvironment();
      delete environment.SANDBOX_BACKEND;
      const loaded = loadSpawnerConfiguration(environment);
      expect(loaded.backend).toBe('docker');
      expect(
        loaded.warnings.filter((line) => line.includes('has no effect')),
      ).not.toEqual([]);
    });
  },
);
