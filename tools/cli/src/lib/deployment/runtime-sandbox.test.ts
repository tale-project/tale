import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';

import {
  hash,
  readRuntimeBundle,
  RUNTIME_SERVICES,
  type ComposeDocument,
} from './runtime-model';
import { prepareRuntime } from './runtime-prepare';
import {
  incusImage,
  isEgressProxy,
  isUnicastIpv4,
  SANDBOX_INCUS_MOUNT,
  SANDBOX_OWNED_VARIABLES,
  sandboxBundleSchema,
  sandboxDeclarationSchema,
  sandboxPorts,
} from './runtime-sandbox';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

// The preparation tests build the git runtime fixture; Windows CI runners
// stall on git for seconds at a time, and the 5 s default killed a passing
// test mid-commit.
setDefaultTimeout(30_000);

const DECLARED = {
  address: '10.200.50.2',
  egressProxy: 'http://10.200.40.10:3128',
};
const DIGEST =
  'sha256:d3a38012f894f0c407c4d8603af07d3879eb4eb161fa0c3592268459cc099fdb';

describe('the Incus sandbox declaration', () => {
  test.each([
    '10.200.50.2',
    '192.168.0.1',
    '172.16.4.9',
    '8.8.8.8',
    '223.255.255.254',
  ])('accepts the unicast address %s', (address) => {
    expect(isUnicastIpv4(address)).toBe(true);
  });

  test.each([
    '0.0.0.0',
    '0.1.2.3',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.0.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '10.200.50',
    '10.200.50.2.1',
    '10.200.50.256',
    '010.200.50.2',
    '10.200.50.02',
    ' 10.200.50.2',
    '10.200.50.2 ',
    'docker-host',
    '::1',
    '[::1]',
    '10.200.50.2/24',
    '',
  ])('refuses the address %j', (address) => {
    expect(isUnicastIpv4(address)).toBe(false);
  });

  test.each([
    'http://10.200.40.10:3128',
    'http://192.168.1.5:8080',
    'http://10.0.0.1:1',
    'http://10.0.0.1:65535',
  ])('accepts the egress proxy %s', (proxy) => {
    expect(isEgressProxy(proxy)).toBe(true);
  });

  test.each([
    'https://10.200.40.10:3128',
    'http://10.200.40.10',
    'http://10.200.40.10:80',
    'http://10.200.40.10:0',
    'http://10.200.40.10:65536',
    'http://sandbox-egress:3128',
    'http://[::1]:3128',
    'http://10.200.40.10:3128/',
    'http://10.200.40.10:3128/path',
    'http://10.200.40.10:3128?query=1',
    'http://10.200.40.10:3128#fragment',
    'http://user:secret@10.200.40.10:3128',
    'http://user@10.200.40.10:3128',
    'http://0.0.0.0:3128',
    'http://127.0.0.1:3128',
    'http://169.254.169.254:3128',
    'http://224.0.0.1:3128',
    'http://255.255.255.255:3128',
    'http://0x7f.1:3128',
    'http://010.0.0.1:3128',
    'http://10.200.40.10:3128 ',
    '10.200.40.10:3128',
    '',
  ])('refuses the egress proxy %j', (proxy) => {
    expect(isEgressProxy(proxy)).toBe(false);
  });

  test('holds the declaration to its three keys', () => {
    expect(
      sandboxDeclarationSchema.safeParse({ backend: 'incus', ...DECLARED }),
    ).toMatchObject({ success: true });
    for (const declaration of [
      { backend: 'docker', ...DECLARED },
      { backend: 'incus', ...DECLARED, extra: true },
      { backend: 'incus', address: DECLARED.address },
      { backend: 'incus', egressProxy: DECLARED.egressProxy },
      { address: DECLARED.address, egressProxy: DECLARED.egressProxy },
      {
        backend: 'incus',
        address: '0.0.0.0',
        egressProxy: DECLARED.egressProxy,
      },
      {
        backend: 'incus',
        address: DECLARED.address,
        egressProxy: 'https://10.0.0.1:3128',
      },
    ])
      expect(sandboxDeclarationSchema.safeParse(declaration).success).toBe(
        false,
      );
  });

  test('derives the image alias from the first 32 digits of the digest', () => {
    const image = incusImage({
      digest: DIGEST,
      reference: `ghcr.io/tale-project/tale/tale-sandbox-runtime@${DIGEST}`,
    });
    expect(image).toEqual({
      alias: 'tale-sandbox-runtime-d3a38012f894f0c407c4d8603af07d38',
      source: `ghcr.io/tale-project/tale/tale-sandbox-runtime@${DIGEST}`,
    });
    // Incus names an alias with at most 64 characters.
    expect(image.alias).toHaveLength(53);
    expect(image.alias.length).toBeLessThanOrEqual(64);
    expect(
      incusImage({
        digest: `sha256:${'0'.repeat(32)}${'1'.repeat(32)}`,
        reference: `ghcr.io/tale-project/tale/tale-sandbox-runtime@sha256:${'0'.repeat(32)}${'1'.repeat(32)}`,
      }).alias,
    ).toBe(`tale-sandbox-runtime-${'0'.repeat(32)}`);
  });

  test('names a digest reference of the runtime image and nothing else as the image source', () => {
    for (const source of [
      'ghcr.io/tale-project/tale/tale-sandbox-runtime:latest',
      'ghcr.io/tale-project/tale/tale-sandbox@' + DIGEST,
      `tale-sandbox-runtime@${DIGEST}`,
      'ghcr.io/tale-project/tale/tale-sandbox-runtime@sha256:short',
    ])
      expect(
        sandboxBundleSchema.safeParse({
          backend: 'incus',
          ...DECLARED,
          image: {
            alias: 'tale-sandbox-runtime-d3a38012f894f0c407c4d8603af07d38',
            source,
          },
        }).success,
      ).toBe(false);
  });

  test('publishes the backend API and the LLM gateway on the declared address only', () => {
    expect(sandboxPorts('10.200.50.2')).toEqual({
      'backend-api': ['10.200.50.2:3005:3005'],
      'sandbox-llm-gateway': ['10.200.50.2:8080:8080'],
    });
  });

  test('owns exactly ten variables of the sandbox service', () => {
    expect([...SANDBOX_OWNED_VARIABLES].sort()).toEqual([
      'SANDBOX_BACKEND',
      'SANDBOX_EGRESS_NETWORK',
      'SANDBOX_EGRESS_PROXY',
      'SANDBOX_HUB_PORT',
      'SANDBOX_INCUS_CLIENT_CERT_FILE',
      'SANDBOX_INCUS_CLIENT_KEY_FILE',
      'SANDBOX_INCUS_IMAGE',
      'SANDBOX_INCUS_IMAGE_SOURCE',
      'SANDBOX_INCUS_SERVER_CERT_FILE',
      'SANDBOX_RUNTIME',
    ]);
  });

  test('mounts the credentials directory by a source relative to the Compose file', () => {
    expect(SANDBOX_INCUS_MOUNT).toBe('../sandbox-incus:/run/secrets/incus:ro');
  });
});

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});
function create() {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  const prepare = (sandbox?: typeof DECLARED) =>
    prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
        sandbox,
      },
      docker.dependencies(),
    );
  return { fixture, docker, prepare };
}

interface Manifest {
  files: Record<string, string>;
  sandbox: Record<string, unknown> & { image: Record<string, unknown> };
}

/** Prepare a bundle, change its compose file and manifest the way a hand edit
 * would, and keep the manifest's file digest true, so that only the rules
 * about the sandbox shape can refuse the result. */
async function edited(
  declared: typeof DECLARED | undefined,
  edit: (compose: ComposeDocument, manifest: Manifest) => void,
): Promise<string> {
  const { fixture, prepare } = create();
  await prepare(declared);
  const directory = fixture.options.bundleDirectory;
  const compose = parse(
    readFileSync(join(directory, 'compose.yml'), 'utf8'),
  ) as ComposeDocument;
  const manifest = JSON.parse(
    readFileSync(join(directory, 'runtime.json'), 'utf8'),
  ) as Manifest;
  edit(compose, manifest);
  const text = stringify(compose);
  writeFileSync(join(directory, 'compose.yml'), text);
  manifest.files['compose.yml'] = hash(text);
  writeFileSync(join(directory, 'runtime.json'), JSON.stringify(manifest));
  return directory;
}
const environmentOf = (compose: ComposeDocument) =>
  compose.services.sandbox.environment as Record<string, string>;

describe('reading a bundle that records the Incus sandbox', () => {
  test('reads what it prepared, in the shape of the record', async () => {
    const { fixture, prepare } = create();
    const bundle = await prepare(DECLARED);
    const verified = readRuntimeBundle(fixture.options.bundleDirectory);
    expect(verified.bundle).toEqual(bundle);
    expect(verified.bundle.sandbox).toEqual({
      backend: 'incus',
      ...DECLARED,
      image: {
        alias: expect.stringMatching(/^tale-sandbox-runtime-[a-f0-9]{32}$/),
        source: expect.stringMatching(/\/tale-sandbox-runtime@sha256:/),
      },
    });
  });

  test.each([
    [
      'drops the record from the manifest while the compose file keeps the Incus mount',
      (_: ComposeDocument, manifest: Manifest) => {
        Reflect.deleteProperty(manifest, 'sandbox');
      },
      'Runtime source contains an unrecognized',
    ],
    [
      'changes the recorded address',
      (_: ComposeDocument, manifest: Manifest) => {
        manifest.sandbox.address = '10.200.50.3';
      },
      'published port',
    ],
    [
      'changes the recorded egress proxy',
      (_: ComposeDocument, manifest: Manifest) => {
        manifest.sandbox.egressProxy = 'http://10.200.40.11:3128';
      },
      'Incus shape',
    ],
    [
      'rewrites the recorded alias',
      (_: ComposeDocument, manifest: Manifest) => {
        manifest.sandbox.image.alias = `tale-sandbox-runtime-${'a'.repeat(32)}`;
      },
      'runtime image',
    ],
    [
      'rewrites the recorded source',
      (_: ComposeDocument, manifest: Manifest) => {
        manifest.sandbox.image.source = `ghcr.io/example/tale-sandbox-runtime@sha256:${'a'.repeat(64)}`;
      },
      'runtime image',
    ],
    [
      'records a backend other than Incus',
      (_: ComposeDocument, manifest: Manifest) => {
        manifest.sandbox.backend = 'docker';
      },
      'manifest',
    ],
    [
      'adds a key to the record',
      (_: ComposeDocument, manifest: Manifest) => {
        manifest.sandbox.credentials = '/opt/credentials';
      },
      'manifest',
    ],
    [
      'publishes a port of the spawner',
      (compose: ComposeDocument) => {
        compose.services.sandbox.ports = ['10.200.50.2:8003:8003'];
      },
      'published port',
    ],
    [
      'publishes a port of the proxy beside the pair',
      (compose: ComposeDocument) => {
        compose.services['backend-api'].ports = [
          '10.200.50.2:3005:3005',
          '10.200.50.2:3006:3006',
        ];
      },
      'published port',
    ],
    [
      'publishes the backend API on all interfaces',
      (compose: ComposeDocument) => {
        compose.services['backend-api'].ports = ['3005:3005'];
      },
      'published port',
    ],
    [
      'publishes the gateway on another address',
      (compose: ComposeDocument) => {
        compose.services['sandbox-llm-gateway'].ports = [
          '10.200.50.9:8080:8080',
        ];
      },
      'published port',
    ],
    [
      'stops publishing the gateway',
      (compose: ComposeDocument) => {
        delete compose.services['sandbox-llm-gateway'].ports;
      },
      'published port',
    ],
    [
      'adds a host mount to the spawner',
      (compose: ComposeDocument) => {
        (compose.services.sandbox.volumes as string[]).push('/etc:/etc');
      },
      'host mount',
    ],
    [
      'brings back the Docker socket beside the credentials',
      (compose: ComposeDocument) => {
        (compose.services.sandbox.volumes as string[]).unshift(
          '/var/run/docker.sock:/var/run/docker.sock',
        );
      },
      'Incus shape',
    ],
    [
      'drops the config volume',
      (compose: ComposeDocument) => {
        compose.services.sandbox.volumes = [SANDBOX_INCUS_MOUNT];
      },
      'Incus shape',
    ],
    [
      'mounts the credentials into another service',
      (compose: ComposeDocument) => {
        (compose.services.proxy.volumes as string[]).push(SANDBOX_INCUS_MOUNT);
      },
      'host mount',
    ],
    [
      'brings back a variable the shape removes',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_HUB_PORT = '8004';
      },
      'Incus shape',
    ],
    [
      'brings back the Docker egress network',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_EGRESS_NETWORK = 'tale-sandbox-net';
      },
      'Incus shape',
    ],
    [
      'changes the egress literal alone',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_EGRESS_PROXY =
          'http://10.200.40.11:3128';
      },
      'Incus shape',
    ],
    [
      'changes the backend literal',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_BACKEND = 'docker';
      },
      'Incus shape',
    ],
    [
      'points the image literal at another alias',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_INCUS_IMAGE =
          `tale-sandbox-runtime-${'b'.repeat(32)}`;
      },
      'Incus shape',
    ],
    [
      'points the credentials at another directory',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_INCUS_CLIENT_KEY_FILE =
          '/run/secrets/other/client.key';
      },
      'Incus shape',
    ],
    [
      'drops a literal',
      (compose: ComposeDocument) => {
        delete environmentOf(compose).SANDBOX_INCUS_SERVER_CERT_FILE;
      },
      'Incus shape',
    ],
  ] as const)('refuses a bundle that %s', async (_, edit, message) => {
    const directory = await edited(DECLARED, edit);
    expect(() => readRuntimeBundle(directory)).toThrow(message);
  });

  test.each([
    [
      'records the Incus sandbox',
      (_: ComposeDocument, manifest: Manifest) => {
        manifest.sandbox = {
          backend: 'incus',
          ...DECLARED,
          image: {
            alias: `tale-sandbox-runtime-${'a'.repeat(32)}`,
            source: `ghcr.io/tale-project/tale/tale-sandbox-runtime@sha256:${'a'.repeat(64)}`,
          },
        };
      },
      'published port',
    ],
    [
      'mounts the Incus credentials',
      (compose: ComposeDocument) => {
        (compose.services.sandbox.volumes as string[]).push(
          SANDBOX_INCUS_MOUNT,
        );
      },
      'host mount',
    ],
    [
      'publishes the backend API',
      (compose: ComposeDocument) => {
        compose.services['backend-api'].ports = ['10.200.50.2:3005:3005'];
      },
      'published port',
    ],
    [
      'publishes the LLM gateway',
      (compose: ComposeDocument) => {
        compose.services['sandbox-llm-gateway'].ports = [
          '10.200.50.2:8080:8080',
        ];
      },
      'published port',
    ],
    [
      'sets the Incus backend',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_BACKEND = 'incus';
      },
      'Incus backend',
    ],
    [
      'sets an Incus image',
      (compose: ComposeDocument) => {
        environmentOf(compose).SANDBOX_INCUS_IMAGE = 'tale-sandbox-runtime-x';
      },
      'Incus backend',
    ],
  ] as const)('refuses a Docker bundle that %s', async (_, edit, message) => {
    const directory = await edited(undefined, edit);
    expect(() => readRuntimeBundle(directory)).toThrow(message);
  });

  test('still reads a bundle an earlier CLI prepared, with the source port forms and its own literals', async () => {
    const directory = await edited(undefined, (compose) => {
      compose.services.sandbox.ports = [
        '127.0.0.1:8003:8003',
        '127.0.0.1:8004:8004',
      ];
      const environment = environmentOf(compose);
      expect(environment.SANDBOX_EGRESS_PROXY).toBe(
        'http://sandbox-egress:3128',
      );
      expect(environment.SANDBOX_RUNTIME).toBe('${SANDBOX_RUNTIME:-runc}');
      environment.SANDBOX_BACKEND = 'docker';
    });
    const { bundle, compose } = readRuntimeBundle(directory);
    expect(bundle).not.toHaveProperty('sandbox');
    expect(compose.services.sandbox.ports).toEqual([
      '127.0.0.1:8003:8003',
      '127.0.0.1:8004:8004',
    ]);
  });

  test('keeps every service but three byte-identical to the Docker bundle of the same source', async () => {
    const { fixture, docker } = create();
    const output = (name: string) => join(fixture.directory, name);
    const options = (name: string, sandbox?: typeof DECLARED) => ({
      repoRoot: fixture.repoRoot,
      revision: fixture.revision,
      output: output(name),
      platform: 'linux/amd64' as const,
      sandbox,
    });
    await prepareRuntime(options('docker'), docker.dependencies());
    await prepareRuntime(options('incus', DECLARED), docker.dependencies());
    const plain = readRuntimeBundle(output('docker'));
    const incus = readRuntimeBundle(output('incus'));
    const changed = new Set(['sandbox', 'backend-api', 'sandbox-llm-gateway']);
    for (const service of RUNTIME_SERVICES.filter((name) => !changed.has(name)))
      expect(incus.compose.services[service]).toEqual(
        plain.compose.services[service],
      );
    expect({ ...incus.compose, services: undefined }).toEqual({
      ...plain.compose,
      services: undefined,
    });
    expect(incus.contents['Caddyfile.production']).toEqual(
      plain.contents['Caddyfile.production'],
    );
    expect({ ...incus.bundle, sandbox: undefined, files: undefined }).toEqual({
      ...plain.bundle,
      sandbox: undefined,
      files: undefined,
    });
  });
});
