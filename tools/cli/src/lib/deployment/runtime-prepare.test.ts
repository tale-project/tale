import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';

import {
  hash,
  parseCompose,
  readRuntimeBundle,
  RUNTIME_SERVICES,
  TALE_REGISTRY,
} from './runtime-model';
import { prepareRuntime } from './runtime-prepare';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture.directory, { recursive: true, force: true });
});
function create() {
  const fixture = runtimeFixture();
  fixtures.push(fixture);
  const docker = new RuntimeDockerFixture(fixture);
  const prepare = () =>
    prepareRuntime(
      {
        repoRoot: fixture.repoRoot,
        revision: fixture.revision,
        output: fixture.options.bundleDirectory,
        platform: 'linux/amd64',
      },
      docker.dependencies(),
    );
  return { fixture, docker, prepare };
}

describe('committed source runtime preparation', () => {
  test('uses committed blobs, produces only exact digest-pinned production files', async () => {
    const { fixture, docker, prepare } = create();
    const committed = readFileSync(join(fixture.repoRoot, 'compose.yml'));
    writeFileSync(
      join(fixture.repoRoot, 'compose.yml'),
      'uncommitted wrong source',
    );
    const bundle = await prepare();
    const verified = readRuntimeBundle(fixture.options.bundleDirectory);
    expect(bundle.source.composeSha256).toBe(hash(committed));
    expect(verified.bundle).toEqual(bundle);
    expect(readdirSync(fixture.options.bundleDirectory).sort()).toEqual([
      'Caddyfile.production',
      'compose.yml',
      'runtime.json',
    ]);
    expect(bundle.services).toEqual([...RUNTIME_SERVICES]);
    expect(Object.keys(verified.compose.volumes).sort()).toEqual(
      Object.keys(fixture.source.volumes).sort(),
    );
    expect(bundle.images).toHaveLength(11);
    for (const image of bundle.images) {
      expect(image.reference).toBe(`${image.repository}@${image.digest}`);
      expect(image.architecture).toBe('amd64');
      if (image.repository.startsWith(`${TALE_REGISTRY}/`))
        expect(image.revision).toBe(fixture.revision);
    }
    for (const service of Object.values(verified.compose.services)) {
      expect(service.build).toBeUndefined();
      expect(service.image).toContain('@sha256:');
      expect(service.pull_policy).toBe('never');
    }
    expect(verified.compose.services.db.ports).toEqual(['127.0.0.1:5432:5432']);
    expect(verified.compose.services['knowledge-db'].ports).toEqual([
      '127.0.0.1:5433:5432',
    ]);
    const environment = verified.compose.services.sandbox.environment as Record<
      string,
      string
    >;
    expect(environment.SANDBOX_RUNTIME_IMAGE).toContain(
      '/tale-sandbox-runtime@sha256:',
    );
    expect(environment.SANDBOX_BUILDKITD_IMAGE).toContain(
      '/tale-sandbox-buildkitd@sha256:',
    );
    expect(environment.SANDBOX_BUILDKITD_MIRROR_IMAGE).toMatch(
      /^registry@sha256:/,
    );
    expect(verified.contents['Caddyfile.production'].toString()).not.toContain(
      '{$DOCS_ORIGIN:',
    );
    expect(docker.calls.every((call) => call.options?.silent === true)).toBe(
      true,
    );
    const before = readFileSync(
      join(fixture.options.bundleDirectory, 'runtime.json'),
    );
    await prepare();
    expect(
      readFileSync(join(fixture.options.bundleDirectory, 'runtime.json')),
    ).toEqual(before);
  });

  test('prefers exact historical release tags over a differently built CI alias', async () => {
    const { fixture, docker, prepare } = create();
    fixture.git('tag', 'v0.5.16');
    const bundle = await prepare();
    expect(
      bundle.images
        .filter((image) => image.revision)
        .every((image) => image.sourceTag === '0.5.16'),
    ).toBe(true);
    expect(
      docker.calls
        .filter((call) => call.args[0] === 'pull')
        .some((call) => call.args.at(-1)?.includes(':sha-')),
    ).toBe(false);
  });

  test('historical aliases for one commit must resolve to identical image bytes', async () => {
    const { fixture, docker, prepare } = create();
    fixture.git('tag', 'v0.5.16');
    fixture.git('tag', 'v0.5.17');
    docker.variantTag = '0.5.17';
    await expect(prepare()).rejects.toThrow('different image bytes');
    expect(docker.calls.filter((call) => call.args[0] === 'pull')).toHaveLength(
      2,
    );
  });

  test('falls back to a short alias only with the complete matching OCI revision', async () => {
    const { fixture, docker, prepare } = create();
    docker.missingTags.add(`sha-${fixture.revision}`);
    const bundle = await prepare();
    expect(
      bundle.images
        .filter((image) => image.revision)
        .every(
          (image) => image.sourceTag === `sha-${fixture.revision.slice(0, 7)}`,
        ),
    ).toBe(true);
  });

  test.each(['revision', 'architecture'] as const)(
    'refuses mismatched %s before publishing any bundle',
    async (field) => {
      const { fixture, docker, prepare } = create();
      if (field === 'revision')
        docker.imageRevision = `${fixture.revision.slice(0, 7)}${'0'.repeat(33)}`;
      else docker.architecture = 'arm64';
      await expect(prepare()).rejects.toThrow(
        field === 'revision' ? 'source revision' : 'platform',
      );
      expect(readdirSync(fixture.directory)).not.toContain('bundle');
    },
  );

  test.each(['service', 'proxy'] as const)(
    'rejects changed %s contract before image resolution',
    async (changed) => {
      const { fixture, docker, prepare } = create();
      if (changed === 'service') {
        delete fixture.source.services['knowledge-db'];
        writeFileSync(
          join(fixture.repoRoot, 'compose.yml'),
          stringify(fixture.source),
        );
      } else
        writeFileSync(
          join(fixture.repoRoot, 'services/proxy/Caddyfile'),
          'changed proxy',
        );
      fixture.git('add', '.');
      fixture.git('commit', '-qm', 'change source contract');
      fixture.revision = fixture.git('rev-parse', 'HEAD');
      await expect(prepare()).rejects.toThrow();
      expect(docker.calls).toHaveLength(0);
    },
  );

  test('refuses output tampering and complete source commit aliases', async () => {
    const { fixture, docker, prepare } = create();
    await prepare();
    writeFileSync(
      join(fixture.options.bundleDirectory, 'compose.yml'),
      'tampered',
    );
    expect(() => readRuntimeBundle(fixture.options.bundleDirectory)).toThrow(
      'digest differs',
    );
    await expect(prepare()).rejects.toThrow('Existing runtime bundle differs');
    await expect(
      prepareRuntime(
        {
          repoRoot: fixture.repoRoot,
          revision: 'HEAD',
          output: fixture.options.bundleDirectory,
          platform: 'linux/amd64',
        },
        docker.dependencies(),
      ),
    ).rejects.toThrow();
  });

  test('a rewritten bundle manifest cannot remove production database policy', async () => {
    const { fixture, prepare } = create();
    const bundle = await prepare();
    const file = join(fixture.options.bundleDirectory, 'compose.yml');
    const compose = parse(readFileSync(file, 'utf8'));
    compose.services.db.ports = ['5432:5432'];
    const changed = stringify(compose);
    writeFileSync(file, changed);
    bundle.files['compose.yml'] = hash(changed);
    writeFileSync(
      join(fixture.options.bundleDirectory, 'runtime.json'),
      JSON.stringify(bundle),
    );
    expect(() => readRuntimeBundle(fixture.options.bundleDirectory)).toThrow(
      'database exposure',
    );
  });

  test.each(['\n', '\r', '\0', '\u2028'])(
    'refuses a full revision with trailing control text',
    async (suffix) => {
      const { fixture, docker } = create();
      await expect(
        prepareRuntime(
          {
            repoRoot: fixture.repoRoot,
            revision: fixture.revision + suffix,
            output: fixture.options.bundleDirectory,
            platform: 'linux/amd64',
          },
          docker.dependencies(),
        ),
      ).rejects.toThrow();
      expect(docker.calls).toHaveLength(0);
    },
  );

  test('rejects newline-suffixed bundle image tokens and nonnumeric schema versions', async () => {
    const { fixture, prepare } = create();
    const bundle = await prepare();
    const manifest = join(fixture.options.bundleDirectory, 'runtime.json');
    for (const key of [
      'repository',
      'digest',
      'reference',
      'sourceTag',
    ] as const) {
      const changed = structuredClone(bundle);
      changed.images[0][key] += '\n';
      writeFileSync(manifest, JSON.stringify(changed));
      expect(() =>
        readRuntimeBundle(fixture.options.bundleDirectory),
      ).toThrow();
    }
    writeFileSync(
      manifest,
      JSON.stringify({ ...bundle, schemaVersion: '1\n' }),
    );
    expect(() => readRuntimeBundle(fixture.options.bundleDirectory)).toThrow();
  });

  test.each([
    'host mount',
    'volume remap',
    'network bypass',
    'network remap',
    'environment file',
    'published port',
  ])('refuses source topology drift through %s', (kind) => {
    const { fixture } = create();
    const source = structuredClone(fixture.source);
    if (kind === 'host mount')
      source.services.platform.volumes = ['/etc:/host:ro'];
    if (kind === 'volume remap')
      source.volumes['db-data'] = { external: true, name: 'other-data' };
    if (kind === 'network bypass')
      source.services.platform.network_mode = 'host';
    if (kind === 'network remap')
      source.networks.internal = { driver: 'bridge', external: true };
    if (kind === 'environment file')
      source.services.platform.env_file = ['../other.env'];
    if (kind === 'published port')
      source.services['backend-api'].ports = ['3005:3005'];
    expect(() => parseCompose(stringify(source))).toThrow();
  });

  test('attests spawner child images even when the Compose file hash is rewritten', async () => {
    const { fixture, prepare } = create();
    const bundle = await prepare();
    const file = join(fixture.options.bundleDirectory, 'compose.yml');
    const source = parse(readFileSync(file, 'utf8'));
    source.services.sandbox.environment.SANDBOX_RUNTIME_IMAGE =
      'unverified:latest';
    const changed = stringify(source);
    writeFileSync(file, changed);
    bundle.files['compose.yml'] = hash(changed);
    writeFileSync(
      join(fixture.options.bundleDirectory, 'runtime.json'),
      JSON.stringify(bundle),
    );
    expect(() => readRuntimeBundle(fixture.options.bundleDirectory)).toThrow(
      'spawner image custody',
    );
  });
});
