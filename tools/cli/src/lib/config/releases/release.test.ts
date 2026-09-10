import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { unpack } from './archive';
import { loadClient, sha256, stableJson, valueHash } from './identity';
import { loadRelease, validateManifest } from './manifest';
import {
  clientSchema,
  manifestSchema,
  record,
  integer,
  slug,
  version,
  gitSha,
  sha,
  owner,
} from './model';
import { buildRelease, verifyArtifact, createImmutable } from './release';
import { released, fixture, temporary } from './tests/fixture';
import { historicalFixture } from './tests/legacy-fixture';

for (const [client, skills, external] of [
  ['acme', ['invoice'], []],
  ['north-labs', ['invoice', 'invoice-tools'], ['pdf']],
] as [string, string[], string[]][]) {
  test(`${client}: committed descriptor, two skill shapes, deterministic ZIPs and full native projection`, async () => {
    const f = await released(client, skills, external);
    const context = loadClient(f.descriptorPath, f.name);
    const { manifest } = f.release;
    expect(manifest.sourceCommit).toBe(f.options.sourceCommit);
    expect(manifest.sourceRepository).toBe(f.descriptor.sourceRepository);
    expect(manifest.descriptorSha256).toBe(
      sha256(readFileSync(f.descriptorPath)),
    );
    const entries = await unpack(f.release.bytes);
    expect(entries.some((entry) => entry.path.endsWith('.gitignore'))).toBe(
      false,
    );
    expect(
      entries.find((entry) => entry.path.endsWith('scripts/run.py'))
        ?.executable,
    ).toBe(true);
    const text = entries
      .find((entry) => entry.path.endsWith('workflow.yml'))!
      .bytes.toString();
    if (external.length) expect(text).toContain('invoice-unrelated');
    for (const skill of skills) expect(text).toContain(`${skill}-v2-3-4`);
    writeFileSync(
      path.join(f.pack, 'workflow.yml'),
      'dirty work must never be released',
    );
    expect((await buildRelease(f.options)).bytes.equals(f.release.bytes)).toBe(
      true,
    );
    const verified = await verifyArtifact({
      ...f.options,
      manifestPath: f.manifestPath,
      rebuild: true,
      validateNative: f.options.validateNative,
    });
    expect(verified.bytes.equals(f.release.bytes)).toBe(true);
    expect(loadRelease(f.manifestPath, context).manifest.artifact.sha256).toBe(
      manifest.artifact.sha256,
    );
    const different = Buffer.from('preserve existing');
    writeFileSync(f.release.artifactPath, different);
    await expect(buildRelease(f.options)).rejects.toThrow(
      'refusing to replace',
    );
    expect(readFileSync(f.release.artifactPath)).toEqual(different);
  }, 30_000);
}

test('source/descriptor corruption and malformed identity refuse before release writes', async () => {
  const f = await released();
  const context = loadClient(f.descriptorPath, f.name);
  for (const change of [
    { sourceCommit: 'short' },
    { schemaVersion: 99 },
    { compilerVersion: 1 },
    { clientId: 'someone' },
    { sourceRepository: 'https://github.com/another/repo' },
    { displayName: 'QA weird' },
    { packPath: '../escape' },
    { descriptorSha256: undefined },
    { skillSlugs: [] },
    { requiredExternalSkills: ['pdf'] },
  ])
    expect(() =>
      validateManifest({ ...f.release.manifest, ...change }, context),
    ).toThrow();
  const bad = { ...f.release.manifest, packTree: '0'.repeat(40) };
  writeFileSync(f.manifestPath, JSON.stringify(bad));
  await expect(
    verifyArtifact({ ...f.options, manifestPath: f.manifestPath }),
  ).rejects.toThrow('source tree');
  writeFileSync(
    f.manifestPath,
    JSON.stringify({ ...f.release.manifest, descriptorSha256: '0'.repeat(64) }),
  );
  await expect(
    verifyArtifact({ ...f.options, manifestPath: f.manifestPath }),
  ).rejects.toThrow('descriptor provenance');
  expect(() => loadClient(f.descriptorPath, 'unknown')).toThrow('not declared');
}, 30_000);

test('failed native validation never writes an artifact', async () => {
  const f = fixture();
  await expect(
    buildRelease({
      ...f.options,
      validateNative: async () => {
        throw new Error('native rejected');
      },
    }),
  ).rejects.toThrow('native rejected');
  expect(() =>
    readFileSync(path.join(f.directory, 'releases/2.3.4.json')),
  ).toThrow();
}, 30_000);

test('schemas reject unsafe fields and cross-client descriptor ambiguities', () => {
  const f = fixture();
  for (const sourceRepository of [
    'http://example.com/x',
    'https://user:pass@example.com/x',
    'https://example.com/x/',
    'https://example.com/x?q=y',
  ])
    expect(
      clientSchema.safeParse({ ...f.descriptor, sourceRepository }).success,
    ).toBe(false);
  expect(
    clientSchema.safeParse({
      ...f.descriptor,
      automations: [f.descriptor.automations[0], f.descriptor.automations[0]],
    }).success,
  ).toBe(false);
  expect(
    clientSchema.safeParse({
      ...f.descriptor,
      automations: [
        { ...f.descriptor.automations[0], requiredExternalSkills: ['invoice'] },
      ],
    }).success,
  ).toBe(false);
  expect(manifestSchema.safeParse({}).success).toBe(false);
  expect(record([])).toBe(false);
  expect(record(null)).toBe(false);
  expect(record({})).toBe(true);
  expect(integer(0)).toBe(false);
  expect(integer(2)).toBe(true);
  expect(integer('2')).toBe(false);
  expect(stableJson({ b: [false, null], a: 2 })).toBe(
    '{"a":2,"b":[false,null]}',
  );
  expect(() => valueHash(undefined)).toThrow('not JSON');
  const target = path.join(temporary(), 'immutable');
  createImmutable(target, 'same');
  createImmutable(target, 'same');
  expect(() => createImmutable(target, 'different')).toThrow('refusing');
}, 30_000);

test('historical schemas rebuild offline from retained bytes without the original repository', async () => {
  for (const schema of [1, 2] as const) {
    const f = await historicalFixture(schema);
    const isolated = temporary();
    const verified = await verifyArtifact({
      repoRoot: isolated,
      descriptorPath: f.descriptorPath,
      automationName: f.name,
      manifestPath: f.manifestPath,
      rebuild: true,
    });
    expect(verified.bytes).toEqual(f.release.bytes);
    const context = loadClient(f.descriptorPath, f.name);
    const original = readFileSync(f.manifestPath);
    writeFileSync(f.manifestPath, original.toString() + ' ');
    expect(() => loadRelease(f.manifestPath, context)).toThrow(
      'explicitly retained',
    );
  }
}, 30_000);

test('an interrupted write cannot expose partial immutable bytes and its replay completes', async () => {
  const directory = temporary();
  const file = path.join(directory, 'release.zip');
  expect(() =>
    createImmutable(file, 'complete bytes', (fd) => {
      writeFileSync(fd, 'partial');
      throw new Error('disk full');
    }),
  ).toThrow('disk full');
  expect(() => readFileSync(file)).toThrow();
  createImmutable(file, 'complete bytes');
  expect(readFileSync(file, 'utf8')).toBe('complete bytes');
  const f = await released();
  const before = readFileSync(f.release.artifactPath);
  const { unlinkSync } = await import('node:fs');
  unlinkSync(f.manifestPath);
  await buildRelease(f.options);
  expect(readFileSync(f.release.artifactPath)).toEqual(before);
  expect(JSON.parse(readFileSync(f.manifestPath, 'utf8')).artifact.sha256).toBe(
    f.release.manifest.artifact.sha256,
  );
}, 30_000);

test('identity boundaries reject a trailing newline or other noncanonical suffix', () => {
  for (const [schema, value] of [
    [slug, 'client-team'],
    [version, '1.2.3'],
    [gitSha, 'a'.repeat(40)],
    [sha, 'b'.repeat(64)],
    [owner, 'native_owner_id'],
  ] as const) {
    expect(schema.safeParse(value).success).toBe(true);
    for (const suffix of ['\n', '\r\n', '\0', ' ', '\u2028'])
      expect(schema.safeParse(value + suffix).success).toBe(false);
  }
});
