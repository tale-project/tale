import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dir, '../../..');
const library = join(
  repository,
  'services/platform/tests/integration/lib/docker.ts',
);
const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tale-container-metadata-'));
  temporary.push(directory);
  await writeFile(
    join(directory, 'docker'),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PROOF_DIR/calls"\nprintf "%s\\n" "$METADATA"\nexit "$DOCKER_EXIT"\n',
    { mode: 0o755 },
  );
  return directory;
}
async function execute(
  code: string,
  directory: string,
  env: Record<string, string> = {},
) {
  const child = Bun.spawn([process.execPath, '-e', code], {
    cwd: repository,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      PROOF_DIR: directory,
      DOCKER_EXIT: '0',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}
const inspect = `import {imageMetadata} from ${JSON.stringify(library)}; console.log(JSON.stringify(await imageMetadata("test-image:latest")));`;
const metadata = {
  Config: {
    Labels: {
      'org.opencontainers.image.source': 'https://github.com/tale-project/tale',
    },
    User: '10001:10001',
    Env: ['OPENAI_API_KEY=test-key-not-real appended-secret'],
    Healthcheck: { Test: ['CMD', 'true'] },
  },
  Size: 5 * 1024 * 1024,
};

test.skipIf(process.platform === 'win32')(
  'one image-specific inspection supplies labels, user, exact env, health and size',
  async () => {
    const directory = await fixture();
    const result = await execute(inspect, directory, {
      METADATA: JSON.stringify(metadata),
    });
    expect(result.exit, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      labels: metadata.Config.Labels,
      user: '10001:10001',
      env: metadata.Config.Env,
      hasHealthcheck: true,
      sizeMb: 5,
    });
    expect(
      (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n'),
    ).toEqual(['image inspect --format={{json .}} test-image:latest']);
  },
);

test.skipIf(process.platform === 'win32').each([
  ['missing size', { Config: metadata.Config }],
  ['negative size', { ...metadata, Size: -1 }],
  ['invalid config', { ...metadata, Config: null }],
  [
    'nonstring label',
    { ...metadata, Config: { ...metadata.Config, Labels: { source: 7 } } },
  ],
  ['invalid env', { ...metadata, Config: { ...metadata.Config, Env: [7] } }],
  ['invalid user', { ...metadata, Config: { ...metadata.Config, User: 0 } }],
  [
    'invalid healthcheck',
    {
      ...metadata,
      Config: { ...metadata.Config, Healthcheck: { Test: 'true' } },
    },
  ],
])(
  'metadata rejects %s rather than passing zero-size/empty-field checks',
  async (_label, value) => {
    const directory = await fixture();
    const result = await execute(inspect, directory, {
      METADATA: JSON.stringify(value),
    });
    expect(result.exit).not.toBe(0);
    expect(result.stderr).toContain('Invalid image');
  },
);

test.skipIf(process.platform === 'win32')(
  'Docker inspection failure preserves its diagnostic and fails closed',
  async () => {
    const directory = await fixture();
    const result = await execute(inspect, directory, {
      METADATA: JSON.stringify(metadata),
      DOCKER_EXIT: '7',
    });
    expect(result.exit).not.toBe(0);
    expect(result.stderr).toContain(
      'Could not inspect image test-image:latest',
    );
  },
);

test
  .skipIf(process.platform === 'win32')
  .each([undefined, null, { Test: ['NONE'] }, { Test: [] }])(
  'absent or disabled HEALTHCHECK is not accepted: %j',
  async (healthcheck) => {
    const directory = await fixture();
    const result = await execute(inspect, directory, {
      METADATA: JSON.stringify({
        ...metadata,
        Config: { ...metadata.Config, Healthcheck: healthcheck },
      }),
    });
    expect(result.exit, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).hasHealthcheck).toBe(false);
  },
);

async function imageHarness(
  directory: string,
  secret = '',
  missing = '',
  gateway = '',
  metadataFailure = '',
) {
  await writeFile(
    join(directory, 'docker'),
    `#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['PROOF_DIR'] + '/calls', 'a') as stream: stream.write(json.dumps(args) + '\\n')
if args[0] == 'compose':
    if args[-2:] != ['config', '--images']: sys.exit(91)
    for service in ['platform', 'db', 'proxy', 'sandbox-llm-gateway', 'sandbox', 'sandbox-egress']:
        if service != os.environ.get('MISSING_SERVICE'): print('ghcr.io/tale-project/tale/tale-' + service + ':latest')
elif args[:2] == ['image', 'inspect']:
    if any(arg.startswith('--format=') for arg in args):
        if os.environ.get('METADATA_FAILURE') == 'inspect':
            print('Injected inspect failure', file=sys.stderr); sys.exit(7)
        if os.environ.get('METADATA_FAILURE') == 'malformed':
            print('{'); sys.exit(0)
        gateway = 'tale-sandbox-llm-gateway:' in args[-1]
        case = os.environ.get('GATEWAY_CASE') if gateway else ''
        print(json.dumps(dict(Config=dict(Labels={'org.opencontainers.image.source':'source'}, User=case if case in ('root', 'root:app', '0:10001') else '10001', Env=json.loads(os.environ['SECRET']) if os.environ['SECRET'].startswith('[') else [os.environ['SECRET']] if os.environ['SECRET'] else [], Healthcheck=dict(Test=['NONE'] if case == 'health' else ['CMD', 'true'])), Size=(101 if case == 'size' else 1)*1024*1024)))
elif args[0] == 'run':
    if args[-2:] == ['-c', 'ls /app/system/providers | head -1; ls /app/builtin | head -1; stat -c %U /app/data']:
        print('provider\\nbuiltin\\napp')
else:
    sys.exit(92)
`,
    { mode: 0o755 },
  );
  const documentTools = join(
    repository,
    'services/platform/tests/integration/lib/document-tools.ts',
  );
  const harness = join(
    repository,
    'services/platform/tests/integration/container-image-test.ts',
  );
  // The expensive offline tool container has its own conformance gate. This
  // fixture isolates actual image resolution/metadata/security checks.
  const code = `import {mock} from 'bun:test'; mock.module(${JSON.stringify(documentTools)}, () => ({checkDocumentTools: async () => ({exitCode:0, combined:''})})); await import(${JSON.stringify(harness)});`;
  return await execute(code, directory, {
    SKIP_BUILD: 'true',
    PULL_POLICY: 'never',
    SECRET: secret,
    MISSING_SERVICE: missing,
    GATEWAY_CASE: gateway,
    METADATA_FAILURE: metadataFailure,
  });
}

test.skipIf(process.platform === 'win32')(
  'the actual image harness resolves Compose once and inspects each image once',
  async () => {
    const directory = await fixture();
    const result = await imageHarness(directory);
    expect(result.exit, result.stdout + result.stderr).toBe(0);
    const calls: string[][] = (await readFile(join(directory, 'calls'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(calls.filter((args) => args[0] === 'compose')).toHaveLength(1);
    expect(
      calls.filter(
        (args) =>
          args[0] === 'image' &&
          args.some((arg) => arg.startsWith('--format=')),
      ),
    ).toHaveLength(8);
    for (const image of [
      'platform',
      'db',
      'proxy',
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'sandbox-buildkitd',
      'sandbox-runtime',
    ])
      expect(result.stdout).toContain(`${image}: no secrets baked in`);
  },
);

test.skipIf(process.platform === 'win32')(
  'an ENV value cannot hide a secret after a permitted dummy prefix and a space',
  async () => {
    const directory = await fixture();
    const result = await imageHarness(
      directory,
      'OPENAI_API_KEY=test-key-not-real appended-secret',
    );
    expect(result.exit, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('secret OPENAI_API_KEY found in image env');
  },
);

test('the static-site harness reuses the metadata snapshot instead of separate field inspections', async () => {
  const source = await readFile(
    join(repository, 'services/platform/tests/integration/static-site-test.ts'),
    'utf8',
  );
  expect(source.match(/await imageMetadata\(image\)/g)).toHaveLength(1);
  expect(source).not.toContain('await dockerInspect(');
  expect(source).not.toContain('await imageSizeMb(');
  for (const check of [
    'metadata.labels',
    'metadata.user',
    'metadata.hasHealthcheck',
    'metadata.sizeMb',
  ])
    expect(source).toContain(check);
});

test
  .skipIf(process.platform === 'win32')
  .each(['platform', 'db', 'proxy', 'sandbox', 'sandbox-egress'])(
  'the required %s image cannot silently disappear from the Compose resolution',
  async (service) => {
    const directory = await fixture();
    const result = await imageHarness(directory, '', service);
    expect(result.exit, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain(`${service}: required image not found`);
    expect(result.stdout).not.toContain('ALL IMAGE VALIDATION TESTS PASSED');
  },
);

test.skipIf(process.platform === 'win32').each([
  ['root', 'sandbox-llm-gateway: image must not run as root'],
  ['health', 'sandbox-llm-gateway: no HEALTHCHECK instruction'],
  ['size', 'sandbox-llm-gateway: 101 MB exceeds 100 MB budget'],
])(
  'gateway validation catches %s before reporting all images accepted',
  async (policy, diagnostic) => {
    const directory = await fixture();
    const result = await imageHarness(directory, '', '', policy);
    expect(result.exit, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain(diagnostic);
  },
);

test.skipIf(process.platform === 'win32').each(['root:app', '0:10001'])(
  'a group suffix cannot disguise gateway root user %s',
  async (user) => {
    const directory = await fixture();
    const result = await imageHarness(directory, '', '', user);
    expect(result.exit, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain(
      'sandbox-llm-gateway: image must not run as root',
    );
  },
);

test.skipIf(process.platform === 'win32')(
  'a permitted dummy ENV entry cannot conceal a later secret under the same key',
  async () => {
    const directory = await fixture();
    const result = await imageHarness(
      directory,
      JSON.stringify([
        'OPENAI_API_KEY=test-key-not-real',
        'OPENAI_API_KEY=real-secret',
      ]),
    );
    expect(result.exit, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('secret OPENAI_API_KEY found in image env');
  },
);

test.skipIf(process.platform === 'win32').each(['inspect', 'malformed'])(
  'an initial %s metadata failure cannot print an all-images-passed banner',
  async (failure) => {
    const directory = await fixture();
    const result = await imageHarness(directory, '', '', '', failure);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('Image validation could not complete');
    expect(result.stdout).not.toContain('ALL IMAGE VALIDATION TESTS PASSED');
  },
);
