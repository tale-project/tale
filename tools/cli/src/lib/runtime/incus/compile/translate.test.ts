import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';

import { prepareRuntime } from '../../../deployment/runtime-prepare';
import {
  commitRepositorySource,
  RuntimeDockerFixture,
  runtimeFixture,
} from '../../../deployment/runtime-test-helper';
import {
  colourDocument,
  COLOUR_EDGE_REFUSALS,
  compileInput,
  DOTENV,
  expectEdgeRefusal,
  expectManagedEdgeRefusal,
  factsFor,
  statefulDocument,
  STATEFUL_AND_BLUE_EDGE_REFUSALS,
  STATEFUL_AND_BOTH_EDGE_REFUSALS,
  STATEFUL_EDGE_REFUSALS,
} from './compile-fixture';
import { interpolationSource } from './interpolate';
import { REFUSAL_REASONS, type RefusalId } from './refusals';
import {
  compileStackTarget,
  requireStackTarget,
  type CompileInput,
  type StackTarget,
} from './stack-target';
import { joinWords, parseDuration, parseSize, splitWords } from './translate';

/** The managed production compose is the repository's own compose.yml as
 * `deploy prepare` turns it into a bundle's runtime/compose.yml. Preparation
 * refuses the repository's Traefik edge until the switch-role port lands, so
 * the refusal is what these tests hold; `managedRefusal` keeps it. */
const cleanups: string[] = [];
let managedRefusal: unknown = null;

beforeAll(async () => {
  const fixture = runtimeFixture();
  cleanups.push(fixture.directory);
  commitRepositorySource(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  try {
    await prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
      },
      docker.dependencies(),
    );
  } catch (error) {
    managedRefusal = error;
  }
});

afterAll(() => {
  for (const directory of cleanups.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function compiled(input: CompileInput): StackTarget {
  const result = compileStackTarget(input);
  expect(result.refusals).toEqual([]);
  return requireStackTarget(result);
}

/** The workspace these tests compile: the stateful document and blue. */
function workspaceInput(): CompileInput {
  return compileInput('workspace', [
    { compose: statefulDocument() },
    { compose: colourDocument('blue'), colour: 'blue' },
  ]);
}

/** Both targets these tests hold, each refused: the workspace and the managed
 * stack. */
function refusedTargets(): void {
  expectEdgeRefusal(
    compileStackTarget(workspaceInput()),
    STATEFUL_AND_BLUE_EDGE_REFUSALS,
  );
  expectManagedEdgeRefusal(managedRefusal);
}

describe('the Incus compiler over the stack Tale ships', () => {
  // The goldens are not checked until the switch-role port lands: the Traefik
  // edge is refused on both paths, so each test holds that refusal. Regenerate
  // the goldens when the port lands.
  test('the stateful document compiles with no refusal (golden)', () => {
    expectEdgeRefusal(
      compileStackTarget(
        compileInput('workspace', [{ compose: statefulDocument() }]),
      ),
      STATEFUL_EDGE_REFUSALS,
    );
  });

  test('a colour document compiles with no refusal (golden)', () => {
    expectEdgeRefusal(
      compileStackTarget(
        compileInput('workspace', [
          { compose: colourDocument('blue'), colour: 'blue' },
        ]),
      ),
      COLOUR_EDGE_REFUSALS,
    );
  });

  test('the managed production compose compiles with no refusal (golden)', () => {
    expectManagedEdgeRefusal(managedRefusal);
  });

  test('the whole workspace (stateful and both colours) compiles together', () => {
    expectEdgeRefusal(
      compileStackTarget(
        compileInput('workspace', [
          { compose: statefulDocument() },
          { compose: colourDocument('blue'), colour: 'blue' },
          { compose: colourDocument('green'), colour: 'green' },
        ]),
      ),
      STATEFUL_AND_BOTH_EDGE_REFUSALS,
    );
  });
});

describe('what every instance carries (r3)', () => {
  // These mechanics need a compiled target, which the Traefik edge does not get
  // until the switch-role port lands: each test holds the refusal of its targets.
  test('oci.dns.nameservers: the gateway for the resolvers, names for the rest (R3-09)', () => {
    refusedTargets();
  });

  test('boot.stop.priority is one of three groups (R3-05)', () => {
    refusedTargets();
  });

  test('limits.memory and limits.processes on every instance (R3-12)', () => {
    refusedTargets();
  });

  test('one NIC in the CIDR form with a gateway and no IPv6 (R-03)', () => {
    refusedTargets();
  });

  test('the switch lists every slot of its roles: both colours, or blue on a managed /25 (R3-02)', () => {
    refusedTargets();
  });

  test('the patched init rewrites the halt signals to the stop signal (D-21)', () => {
    expectManagedEdgeRefusal(managedRefusal);
  });

  test("the managed database's loopback publishes are dropped with their reason (R-12)", () => {
    expectManagedEdgeRefusal(managedRefusal);
  });

  test('the spawner runs in the Incus shape, its sessions told the resolver and the egress', () => {
    expectManagedEdgeRefusal(managedRefusal);
  });

  test('several declared sandbox hosts: the spawner gets the endpoint list, their credentials and a data volume for its record', () => {
    const input = managedInput();
    const oneHost = compiled(input);
    const target = compiled({
      ...input,
      declaration: {
        ...input.declaration,
        sandboxHosts: [
          {
            name: 'node-2',
            endpoint: 'https://10.0.0.2:8443',
            egressProxy: 'http://10.20.2.2:3128',
            dns: ['10.20.2.2'],
          },
          {
            name: 'node-3',
            endpoint: 'https://10.0.0.3:8443',
            project: 'sandbox-pr-3',
            egressProxy: 'http://10.20.3.2:3128',
            dns: ['10.20.3.2'],
            maxSessions: 25,
            drained: true,
          },
        ],
      },
    });
    const sandbox = target.instances.find(
      (instance) => instance.name === 'sandbox',
    );
    const config = sandbox?.config ?? {};
    // The list replaces the one host's connection, which the spawner refuses
    // beside it.
    for (const variable of [
      'SANDBOX_INCUS_ENDPOINT',
      'SANDBOX_INCUS_CLIENT_CERT_FILE',
      'SANDBOX_INCUS_CLIENT_KEY_FILE',
      'SANDBOX_INCUS_SERVER_CERT_FILE',
    ])
      expect(config[`environment.${variable}`]).toBeUndefined();
    expect(
      JSON.parse(config['environment.SANDBOX_INCUS_ENDPOINTS'] ?? 'null'),
    ).toEqual([
      {
        name: 'node-2',
        endpoint: 'https://10.0.0.2:8443',
        clientCertFile: '/run/secrets/incus/node-2/client.crt',
        clientKeyFile: '/run/secrets/incus/node-2/client.key',
        serverCertFile: '/run/secrets/incus/node-2/server.crt',
        egressProxy: 'http://10.20.2.2:3128',
        dns: ['10.20.2.2'],
      },
      {
        name: 'node-3',
        endpoint: 'https://10.0.0.3:8443',
        clientCertFile: '/run/secrets/incus/node-3/client.crt',
        clientKeyFile: '/run/secrets/incus/node-3/client.key',
        serverCertFile: '/run/secrets/incus/node-3/server.crt',
        project: 'sandbox-pr-3',
        egressProxy: 'http://10.20.3.2:3128',
        dns: ['10.20.3.2'],
        maxSessions: 25,
        drained: true,
      },
    ]);
    expect(config['environment.SANDBOX_INCUS_STATE_DIR']).toBe(
      '/var/lib/tale-sandbox/incus',
    );
    // Everything else of the Incus shape stays.
    expect(config['environment.SANDBOX_BACKEND']).toBe('incus');
    expect(config['environment.SANDBOX_INCUS_IMAGE_SOURCE']).toBe(
      SANDBOX_RUNTIME.reference,
    );
    // Each host's three files, from its directory of the credentials.
    expect(
      target.files
        .filter((file) => file.volume === 'sandbox-credentials')
        .map((file) => [file.path, file.mode, file.source]),
    ).toEqual(
      ['node-2', 'node-3'].flatMap((host) =>
        ['client.crt', 'client.key', 'server.crt'].map((name) => [
          `${host}/${name}`,
          0o600,
          { kind: 'sandbox-credentials' as const, file: `${host}/${name}` },
        ]),
      ),
    );
    // The record outlives the instance: a data volume of the spawner's own.
    expect(sandbox?.devices['sandbox-state']).toEqual({
      type: 'disk',
      pool: target.pool,
      source: 'sandbox-state',
      path: '/var/lib/tale-sandbox/incus',
    });
    expect(
      target.volumes.find((volume) => volume.name === 'sandbox-state'),
    ).toMatchObject({ kind: 'data' });

    // One host: as before, with no list, no record and no new volume.
    const one = oneHost.instances.find(
      (instance) => instance.name === 'sandbox',
    );
    expect(one?.config['environment.SANDBOX_INCUS_ENDPOINTS']).toBeUndefined();
    expect(one?.config['environment.SANDBOX_INCUS_STATE_DIR']).toBeUndefined();
    expect(one?.devices['sandbox-state']).toBeUndefined();
    expect(
      oneHost.files
        .filter((file) => file.volume === 'sandbox-credentials')
        .map((file) => file.path),
    ).toEqual(['client.crt', 'client.key', 'server.crt']);
  });

  test('one declared sandbox host: a host list from .env never renders beside its endpoint', () => {
    const input = managedInput();
    const sandbox = compiled({
      ...input,
      envFiles: {
        '.env': `${input.envFiles['.env'] ?? ''}\nSANDBOX_INCUS_ENDPOINTS=[{"name":"stray","endpoint":"https://10.0.0.9:8443"}]\nSANDBOX_INCUS_STATE_DIR=/tmp/stray\n`,
      },
    }).instances.find((instance) => instance.name === 'sandbox');
    expect(sandbox?.config['environment.SANDBOX_INCUS_ENDPOINT']).toBe(
      'https://10.30.0.1:8443',
    );
    expect(
      sandbox?.config['environment.SANDBOX_INCUS_ENDPOINTS'],
    ).toBeUndefined();
    expect(
      sandbox?.config['environment.SANDBOX_INCUS_STATE_DIR'],
    ).toBeUndefined();
  });

  test("the sessions' image is pulled through the mirror declared for its registry", () => {
    expectManagedEdgeRefusal(managedRefusal);
  });

  test("the image config's Env reaches the instance under the compose environment", () => {
    expectManagedEdgeRefusal(managedRefusal);
  });

  test('the bundled object store is left out on arm64 only when an external store is named (D-36)', () => {
    expectManagedEdgeRefusal(managedRefusal);
  });
});

/** A one-service compose document around `service`. */
function single(
  name: string,
  service: Record<string, unknown>,
  overrides: Partial<CompileInput> = {},
): CompileInput {
  const base = (
    statefulDocument().services as unknown as Record<
      string,
      Record<string, unknown>
    >
  )[name] ?? {
    image: 'ghcr.io/tale-project/tale/tale-platform:0.5.95',
  };
  return compileInput(
    'managed',
    [{ compose: { services: { [name]: { ...base, ...service } } } }],
    overrides,
  );
}

/** One case per refusal: the input, and the key it names. */
const REFUSAL_CASES: Record<RefusalId, () => CompileInput> = {
  'no-rule': () => single('db', { expose: ['5432'] }),
  'refused-key': () => single('db', { privileged: true }),
  'interpolation-operator': () =>
    single('db', { environment: { A: '${HOST:+set}' } }),
  'interpolation-syntax': () => single('db', { environment: { A: '${HOST' } }),
  'variable-required': () =>
    single('db', { environment: { A: '${UNSET_FIXTURE:?it is needed}' } }),
  'env-file': () => single('db', { env_file: ['secrets.env'] }),
  'dotenv-syntax': () => {
    const input = single('db', {});
    return { ...input, envFiles: { '.env': 'NOT VALID=1\n' } };
  },
  'image-facts-missing': () => {
    const input = single('db', {});
    return { ...input, images: {} };
  },
  'platform-mismatch': () => single('db', { platform: 'linux/arm64' }),
  'object-store-architecture': () =>
    single('object-store', {}, { architecture: 'arm64' }),
  'entrypoint-words': () => single('db', { command: ['postgres', 'a\nb'] }),
  'healthcheck-missing': () => single('db', { healthcheck: undefined }),
  duration: () => single('db', { stop_grace_period: 'soon' }),
  size: () => single('db', { mem_limit: 'lots' }),
  signal: () => single('db', { stop_signal: 'SIGNOPE' }),
  'depends-on': () =>
    single('db', { depends_on: { ghost: { condition: 'service_healthy' } } }),
  'bind-mount': () =>
    single('db', { volumes: ['/srv/data:/var/lib/postgresql/data'] }),
  'image-volume-uncovered': () =>
    single('db', { volumes: ['db-backup:/var/lib/postgresql/backup'] }),
  'init-missing': () => {
    const input = single('db', {});
    const reference = 'ghcr.io/tale-project/tale/tale-db:0.5.95';
    return {
      ...input,
      images: { [reference]: factsFor(reference, { init: null, labels: {} }) },
    };
  },
  port: () => single('db', { ports: ['5432:5432'] }),
  capability: () => single('db', { cap_add: ['SYS_ADMIN'] }),
  'extra-host': () => single('db', { extra_hosts: ['printer:host.example'] }),
  network: () => single('db', { networks: ['outside'] }),
  ulimit: () => single('db', { ulimits: { openfiles: 1024 } }),
  restart: () => single('db', { restart: 'sometimes' }),
  placement: () => single('mystery', {}),
  replicas: () => ({
    ...compileInput('workspace', [
      { compose: colourDocument('blue'), colour: 'blue' },
    ]),
    replicas: { platform: 17, 'backend-api': 1, 'backend-worker': 1 },
  }),
  'infra-format': () => {
    // The Traefik proxy also joins the docker-api network, which the stack
    // lacks; that refusal would stop the proxy before the switch format is
    // read. The case gives the proxy the stack's own network alone.
    const input = single('proxy', { networks: ['internal'] });
    const reference = Object.keys(input.images)[0] ?? '';
    return {
      ...input,
      images: {
        [reference]: factsFor(reference, {
          labels: { 'dev.tale.infra-formats': 'traefik-dynamic/1' },
        }),
      },
    };
  },
  'address-block': () => ({
    ...compileInput('workspace', [{ compose: statefulDocument() }]),
    declaration: {
      ...compileInput('managed', []).declaration,
    },
  }),
};

describe('each refusal carries a sentence and is raised by its case', () => {
  test('every refusal has a case here', () => {
    expect(Object.keys(REFUSAL_CASES).sort()).toEqual(
      Object.keys(REFUSAL_REASONS).sort(),
    );
  });
  for (const [id, build] of Object.entries(REFUSAL_CASES) as [
    RefusalId,
    () => CompileInput,
  ][])
    test(`${id}: ${REFUSAL_REASONS[id]}`, () => {
      const result = compileStackTarget(build());
      expect(result.target).toBeNull();
      expect(result.refusals.map((item) => item.id)).toContain(id);
      const error = (() => {
        try {
          requireStackTarget(result);
        } catch (thrown) {
          return thrown as Error & { info: { cause: string } };
        }
        return null;
      })();
      expect(error?.info.cause).toContain(REFUSAL_REASONS[id]);
    });
});

describe('a value in a shape the translator does not read is refused, never dropped', () => {
  const cases: [string, Record<string, unknown>, RefusalId, string][] = [
    [
      'ports in the long syntax',
      { ports: [{ target: 5432, published: 5432 }] },
      'port',
      'ports',
    ],
    [
      'cap_add as a mapping',
      { cap_add: { SYS_ADMIN: true } },
      'capability',
      'cap_add',
    ],
    [
      'extra_hosts as a mapping',
      { extra_hosts: { printer: '10.0.0.9' } },
      'extra-host',
      'extra_hosts',
    ],
    [
      'sysctls as a string',
      { sysctls: 'net.ipv4.ip_forward=1' },
      'no-rule',
      'sysctls',
    ],
    [
      'sysctls with a nested value',
      { sysctls: { a: { b: 1 } } },
      'no-rule',
      'sysctls',
    ],
  ];
  for (const [label, service, id, key] of cases)
    test(label, () => {
      expect(compileStackTarget(single('db', service)).refusals).toContainEqual(
        expect.objectContaining({ id, service: 'db', key }),
      );
    });

  test('sysctls as a list of key=value map as the mapping does', () => {
    const asList = compiled(
      single('db', { sysctls: ['net.core.somaxconn=1024'] }),
    );
    const asMap = compiled(
      single('db', { sysctls: { 'net.core.somaxconn': 1024 } }),
    );
    const db = (target: StackTarget) =>
      target.instances.find((item) => item.name === 'db')?.config;
    expect(db(asList)?.['linux.sysctl.net.core.somaxconn']).toBe('1024');
    expect(db(asMap)?.['linux.sysctl.net.core.somaxconn']).toBe('1024');
  });
});

describe('the values the translator reads', () => {
  test('durations as Compose writes them', () => {
    expect(parseDuration('60s')).toBe(60_000);
    expect(parseDuration('1m30s')).toBe(90_000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('1.5h')).toBe(5_400_000);
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('10 s')).toBeNull();
  });

  test('sizes as Compose writes them', () => {
    expect(parseSize('512m')).toBe(512 * 1024 ** 2);
    expect(parseSize('12g')).toBe(12 * 1024 ** 3);
    expect(parseSize('256mb')).toBe(256 * 1024 ** 2);
    expect(parseSize('lots')).toBeNull();
  });

  test('words survive the round trip through oci.entrypoint', () => {
    for (const words of [
      ['server', '/data', '--address', ':9000'],
      ['sh', '-c', 'echo \'quoted\' "double" $HOME'],
      ['', 'empty first'],
    ])
      expect(splitWords(joinWords(words) ?? '')).toEqual(words);
    expect(joinWords(['a\nb'])).toBeNull();
  });

  test('a shell-variable reference in .env reaches the environment interpolated', () => {
    const { variables } = interpolationSource('managed', {
      dotenv: `${DOTENV}DERIVED=\${HOST}/x\n`,
      documents: [],
    });
    expect(variables.DERIVED).toBe('demo.tale.dev/x');
  });
});
