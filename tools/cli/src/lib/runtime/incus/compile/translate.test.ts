import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

import { prepareRuntime } from '../../../deployment/runtime-prepare';
import {
  commitRepositorySource,
  RuntimeDockerFixture,
  runtimeFixture,
} from '../../../deployment/runtime-test-helper';
import {
  colourDocument,
  compileInput,
  DOTENV,
  expectGolden,
  factsFor,
  SANDBOX_RUNTIME,
  statefulDocument,
} from './compile-fixture';
import { interpolationSource } from './interpolate';
import { STOP_GROUPS } from './placement';
import { REFUSAL_REASONS, type RefusalId } from './refusals';
import {
  compileStackTarget,
  requireStackTarget,
  type CompileInput,
  type StackTarget,
} from './stack-target';
import { joinWords, parseDuration, parseSize, splitWords } from './translate';

/** The managed production compose: the repository's own compose.yml, as
 * `deploy prepare` turns it into a bundle's runtime/compose.yml. */
let managedCompose: Record<string, unknown>;
const cleanups: string[] = [];

beforeAll(async () => {
  const fixture = runtimeFixture();
  cleanups.push(fixture.directory);
  commitRepositorySource(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  await prepareRuntime(
    {
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: fixture.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  managedCompose = parse(
    readFileSync(join(fixture.options.bundleDirectory, 'compose.yml'), 'utf8'),
  ) as Record<string, unknown>;
});

afterAll(() => {
  for (const directory of cleanups.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function managedInput(overrides: Partial<CompileInput> = {}): CompileInput {
  return compileInput('managed', [{ compose: managedCompose }], overrides);
}

function compiled(input: CompileInput): StackTarget {
  const result = compileStackTarget(input);
  expect(result.refusals).toEqual([]);
  return requireStackTarget(result);
}

describe('the Incus compiler over the stack Tale ships', () => {
  test('the stateful document compiles with no refusal (golden)', () => {
    expectGolden(
      'stateful',
      compiled(compileInput('workspace', [{ compose: statefulDocument() }])),
    );
  });

  test('a colour document compiles with no refusal (golden)', () => {
    expectGolden(
      'colour-blue',
      compiled(
        compileInput('workspace', [
          { compose: colourDocument('blue'), colour: 'blue' },
        ]),
      ),
    );
  });

  test('the managed production compose compiles with no refusal (golden)', () => {
    expectGolden('managed-compose', compiled(managedInput()));
  });

  test('the whole workspace (stateful and both colours) compiles together', () => {
    const target = compiled(
      compileInput('workspace', [
        { compose: statefulDocument() },
        { compose: colourDocument('blue'), colour: 'blue' },
        { compose: colourDocument('green'), colour: 'green' },
      ]),
    );
    const names = target.instances.map((instance) => instance.name);
    expect(names).toContain('platform-blue-2');
    expect(names).toContain('backend-api-green-1');
    expect(target.names.stack['platform-blue']).toEqual([
      '10.30.1.64',
      '10.30.1.65',
    ]);
    expect(target.names.stack['platform-green']).toEqual([
      '10.30.1.128',
      '10.30.1.129',
    ]);
    // The switch holds the stable names; the colours never take them.
    expect(target.names.stack.platform).toEqual(['10.30.1.5']);
    expect(target.names.stack['backend-api']).toEqual(['10.30.1.5']);
    expect(target.names.stack['backend-worker']).toEqual([
      '10.30.1.96',
      '10.30.1.160',
    ]);
  });
});

describe('what every instance carries (r3)', () => {
  const targets = (): StackTarget[] => [
    compiled(
      compileInput('workspace', [
        { compose: statefulDocument() },
        { compose: colourDocument('blue'), colour: 'blue' },
      ]),
    ),
    compiled(managedInput()),
  ];

  test('oci.dns.nameservers: the gateway for the resolvers, names for the rest (R3-09)', () => {
    for (const target of targets())
      for (const instance of target.instances)
        expect(instance.config['oci.dns.nameservers'], instance.name).toBe(
          instance.service === 'names' || instance.service === 'names-sessions'
            ? target.network.gateway
            : (target.instances.find((other) => other.name === 'names')
                ?.address ?? 'no names instance'),
        );
  });

  test('boot.stop.priority is one of three groups (R3-05)', () => {
    const groups: Record<number, string[]> = {
      [STOP_GROUPS.edge]: [
        'proxy',
        'switch',
        'platform',
        'backend-api',
        'backend-worker',
      ],
      [STOP_GROUPS.middle]: [
        'sandbox',
        'sandbox-llm-gateway',
        'sandbox-egress',
        'bgutil-provider',
      ],
      [STOP_GROUPS.data]: [
        'db',
        'knowledge-db',
        'object-store',
        'names',
        'names-sessions',
      ],
    };
    for (const target of targets())
      for (const instance of target.instances) {
        const group = Number(instance.config['boot.stop.priority']);
        expect(groups[group], instance.name).toContain(instance.service);
      }
  });

  test('limits.memory and limits.processes on every instance (R3-12)', () => {
    for (const target of targets())
      for (const instance of target.instances) {
        expect(instance.config['limits.memory'], instance.name).toMatch(
          /^\d+(KiB|MiB|GiB)?$/,
        );
        expect(instance.config['limits.processes'], instance.name).toMatch(
          /^\d+$/,
        );
      }
  });

  test('one NIC in the CIDR form with a gateway and no IPv6 (R-03)', () => {
    for (const target of targets())
      for (const instance of target.instances)
        expect(instance.devices.eth0, instance.name).toEqual({
          type: 'nic',
          network: 'talebr0',
          name: 'eth0',
          'ipv4.address': `${instance.address}/16`,
          'ipv4.gateway': '10.30.0.1',
          'ipv6.address': 'none',
        });
  });

  test('the switch lists every slot of its roles: both colours, or blue on a managed /25 (R3-02)', () => {
    const [workspace, managed] = targets();
    expect(workspace?.switch.platform).toHaveLength(32);
    expect(workspace?.switch.platform[0]).toBe('10.30.1.64:3000');
    expect(workspace?.switch.platform[16]).toBe('10.30.1.128:3000');
    expect(workspace?.switch['backend-api'][0]).toBe('10.30.1.80:3005');
    expect(managed?.switch.platform).toHaveLength(16);
    expect(managed?.switch['backend-api'].at(-1)).toBe('10.30.2.95:3005');
  });

  test('the patched init rewrites the halt signals to the stop signal (D-21)', () => {
    const managed = compiled(managedInput());
    const db = managed.instances.find((instance) => instance.name === 'db');
    expect(db?.config['oci.entrypoint']).toBe(
      '/init --single-child --rewrite 30:2 --rewrite 37:2 --rewrite 38:2 -- /usr/local/bin/docker-entrypoint.sh postgres',
    );
    expect(db?.stop).toEqual({ signal: 2, graceSeconds: 60 });
    expect(db?.config['environment.TALE_SHM_SIZE']).toBe('256m');
    const platform = managed.instances.find(
      (instance) => instance.service === 'platform',
    );
    // tini is dropped: the patched init reaps in its place.
    expect(platform?.config['oci.entrypoint']).toBe(
      '/init --single-child --rewrite 30:15 --rewrite 37:15 --rewrite 38:15 -- /app/docker-entrypoint.sh',
    );
    const store = managed.instances.find(
      (instance) => instance.name === 'object-store',
    );
    expect(store?.config['oci.entrypoint']).toBe(
      // The accepted image runs without /init; the compose command replaces
      // the image command after the image entrypoint.
      '/usr/bin/docker-entrypoint.sh server /data --address :9000 --console-address :9001',
    );
  });

  test("the managed database's loopback publishes are dropped with their reason (R-12)", () => {
    const managed = compiled(managedInput());
    for (const service of ['db', 'knowledge-db'])
      expect(
        managed.ignored.some(
          (entry) => entry.service === service && entry.key === 'ports',
        ),
      ).toBe(true);
    expect(managed.ingress).toEqual({
      mode: 'routed',
      proxy: '10.30.2.4',
      ports: [
        { host: 80, container: 80 },
        { host: 443, container: 443 },
      ],
    });
  });

  test('the spawner runs in the Incus shape, its sessions told the resolver and the egress', () => {
    const managed = compiled(managedInput());
    const sandbox = managed.instances.find(
      (instance) => instance.name === 'sandbox',
    );
    expect(sandbox?.config).toMatchObject({
      'environment.SANDBOX_BACKEND': 'incus',
      'environment.SANDBOX_INCUS_DNS': '10.30.2.3',
      'environment.SANDBOX_EGRESS_PROXY': 'http://10.30.2.10:3128',
      'environment.SANDBOX_INCUS_ENDPOINT': 'https://10.30.0.1:8443',
      'environment.SANDBOX_INCUS_IMAGE_SOURCE': SANDBOX_RUNTIME.reference,
    });
    expect(sandbox?.config['environment.SANDBOX_RUNTIME']).toBeUndefined();
    expect(sandbox?.devices['sandbox-credentials']).toMatchObject({
      path: '/run/secrets/incus',
      readonly: 'true',
    });
    const declared = compiled(
      managedInput({ egressProxy: 'http://10.50.0.2:3128' }),
    ).instances.find((instance) => instance.name === 'sandbox');
    expect(declared?.config['environment.SANDBOX_EGRESS_PROXY']).toBe(
      'http://10.50.0.2:3128',
    );
  });

  test('the bundled object store is left out on arm64 only when an external store is named (D-36)', () => {
    const arm = (variables: Record<string, string>): CompileInput => {
      const input = managedInput({ architecture: 'arm64' });
      return { ...input, variables: { ...input.variables, ...variables } };
    };
    const refused = compileStackTarget(arm({}));
    expect(refused.refusals.map((item) => item.id)).toContain(
      'object-store-architecture',
    );
    const external = compileStackTarget(
      arm({ OBJECT_STORE_ENDPOINT: 'https://s3.example.com' }),
    );
    // Every other image is amd64 in the fixture, but only the object store
    // names a platform; the rest run whatever the digest resolves to.
    expect(external.refusals).toEqual([]);
    expect(external.target?.omitted.map((item) => item.service)).toEqual([
      'object-store',
    ]);
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
