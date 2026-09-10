import { expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';

import { unpack } from './archive';
import { compile } from './compiler';
import { committedEntries } from './git';
import { loadClient, releaseIdentity, skillBindings, sha256 } from './identity';
import { loadRelease, validateManifest } from './manifest';
import { buildRelease, verifyArtifact } from './release';
import { stageRelease, verifyStage } from './stage';
import { commandFixture } from './tests/command-fixture';
import { fixture, temporary } from './tests/fixture';

test('full source SHA builds deterministic native artifacts without a semantic label or source writes', async () => {
  for (const [client, owned] of [
    ['acme', true],
    ['north-labs', false],
  ] as const) {
    const f = commandFixture(client, owned);
    const output = path.join(temporary(), 'release');
    const options = { ...f.options, version: undefined, output };
    const clean = f.git('status', '--porcelain=v1', '--untracked-files=all');
    const first = await buildRelease(options);
    expect(first.manifest.schemaVersion).toBe(4);
    expect(first.manifest.compilerVersion).toBe(3);
    expect(first.manifest.version).toBeUndefined();
    expect(releaseIdentity(first.manifest)).toBe(f.options.sourceCommit);
    expect(first.manifest.artifact.path).toBe(
      `${f.options.sourceCommit}/${f.name}.zip`,
    );
    expect(f.git('status', '--porcelain=v1', '--untracked-files=all')).toBe(
      clean,
    );
    const descriptorCopy = path.join(temporary(), 'source-client.json');
    writeFileSync(descriptorCopy, readFileSync(f.descriptorPath));
    writeFileSync(path.join(f.pack, 'workflow.yml'), 'dirty, invalid source');
    writeFileSync(f.descriptorPath, 'dirty, invalid descriptor');
    const dirty = f.git('status', '--porcelain=v1', '--untracked-files=all');
    const second = await buildRelease(options);
    expect(second.bytes).toEqual(first.bytes);
    expect(second.installation).toEqual(first.installation);
    expect(f.git('status', '--porcelain=v1', '--untracked-files=all')).toBe(
      dirty,
    );
    const manifestPath = path.join(output, `${f.options.sourceCommit}.json`);
    const verified = await verifyArtifact({
      ...options,
      descriptorPath: descriptorCopy,
      manifestPath,
      rebuild: true,
    });
    expect(verified.bytes).toEqual(first.bytes);
    expect(existsSync(path.join(f.directory, 'releases'))).toBe(false);
  }
});

test('full SHA skills fit the native budget and shortened logical collisions fail closed', async () => {
  const logical = 'long-logical-skill-name-with-business-meaning';
  const left = 'a'.repeat(39) + '1';
  const right = 'a'.repeat(39) + '2';
  const a = skillBindings([logical], left)[0]!;
  const b = skillBindings([logical], right)[0]!;
  expect(a.releaseSlug.length).toBeLessThanOrEqual(64);
  expect(a.releaseSlug.endsWith(left)).toBe(true);
  expect(b.releaseSlug.endsWith(right)).toBe(true);
  expect(a.releaseSlug).not.toBe(b.releaseSlug);
  const f = fixture('collision-team', [
    logical + '-first',
    logical + '-second',
  ]);
  const output = path.join(temporary(), 'artifacts');
  await expect(
    buildRelease({ ...f.options, version: undefined, output }),
  ).rejects.toThrow('slug collision');
  expect(existsSync(output)).toBe(false);
  const packs = [
    fixture('shared-team', [logical + '-first']),
    fixture('shared-team', [logical + '-second']),
  ];
  const compiled = await Promise.all(
    packs.map((pack) =>
      compile(
        committedEntries(
          pack.root,
          pack.options.sourceCommit,
          path.relative(pack.root, pack.pack),
        ),
        pack.descriptor.automations[0],
        left,
        pack.options.skillOwnerUserId,
      ),
    ),
  );
  expect(compiled[0]!.skills[0]!.slug).toBe(compiled[1]!.skills[0]!.slug);
  expect(
    compiled[0]!.skills[0]!.bytes.equals(compiled[1]!.skills[0]!.bytes),
  ).toBe(false);
  for (const [index, pack] of packs.entries()) {
    const metadata = (await unpack(compiled[index]!.skills[0]!.bytes))
      .find((entry) => entry.path === 'SKILL.md')!
      .bytes.toString();
    expect(metadata).toContain(
      `logicalSlug: ${pack.descriptor.automations[0].logicalSkillSlugs[0]}`,
    );
    expect(metadata).toContain(`sourceCommit: ${left}`);
  }
});

test('SHA stages build from committed source with no catalogue commit cycle and replay exact bytes', async () => {
  for (const [client, owned] of [
    ['acme', true],
    ['north-labs', false],
  ] as const) {
    const f = commandFixture(client, owned);
    const committedDescriptor = readFileSync(f.descriptorPath);
    writeFileSync(f.descriptorPath, 'uncommitted descriptor');
    writeFileSync(path.join(f.pack, 'workflow.yml'), 'uncommitted workflow');
    const before = f.git('status', '--porcelain=v1', '--untracked-files=all');
    const options = {
      repoRoot: f.root,
      descriptorPath: path.relative(f.root, f.descriptorPath),
      automationName: f.name,
      configRef: f.options.sourceCommit,
      skillOwnerUserId: f.options.skillOwnerUserId,
      output: path.join(temporary(), 'stage'),
    };
    const receipt = await stageRelease(options);
    expect(receipt.schemaVersion).toBe(2);
    if (receipt.schemaVersion !== 2) throw new Error('expected SHA stage');
    expect(receipt.releaseRef).toBe(f.options.sourceCommit);
    expect(receipt.sourceCommit).toBe(receipt.releaseRef);
    expect(receipt.deploymentRef).toBeUndefined();
    expect('opsCommit' in receipt || 'configVersion' in receipt).toBe(false);
    expect(await stageRelease(options)).toEqual(receipt);
    const verified = verifyStage(options.output, {
      releaseRef: options.configRef,
      artifactSha256: receipt.artifactSha256,
    });
    expect(readFileSync(verified.descriptorPath)).toEqual(committedDescriptor);
    const release = loadRelease(
      verified.manifestPath,
      loadClient(verified.descriptorPath, f.name),
    );
    expect(releaseIdentity(release.manifest)).toBe(options.configRef);
    expect(sha256(release.bytes)).toBe(receipt.artifactSha256);
    expect(existsSync(path.join(f.directory, 'releases'))).toBe(false);
    expect(existsSync(path.join(f.root, '.tale'))).toBe(false);
    expect(f.git('status', '--porcelain=v1', '--untracked-files=all')).toBe(
      before,
    );
    expect(() =>
      verifyStage(options.output, { releaseRef: 'f'.repeat(40) }),
    ).toThrow('differs from expected');
    const receiptPath = path.join(options.output, 'deployment.json');
    writeFileSync(
      receiptPath,
      JSON.stringify({ ...receipt, sourceCommit: 'f'.repeat(40) }),
    );
    expect(() => verifyStage(options.output)).toThrow('identity differs');
  }
});

test('SHA admission refuses mismatches, ambiguous compatibility, and output inside the checkout', async () => {
  const f = commandFixture();
  const options = {
    repoRoot: f.root,
    descriptorPath: path.relative(f.root, f.descriptorPath),
    automationName: f.name,
    configRef: f.options.sourceCommit,
    skillOwnerUserId: f.options.skillOwnerUserId,
    output: path.join(temporary(), 'stage'),
  };
  for (const change of [
    { configRef: f.options.sourceCommit.slice(0, 12) },
    { configRef: f.options.sourceCommit + '\n' },
    { catalogueCommit: 'f'.repeat(40) },
    { configRef: 'f'.repeat(40) },
    { version: '1.0.0' },
    { opsCommit: 'a'.repeat(40) },
    { output: path.join(f.root, 'generated-stage') },
  ])
    await expect(stageRelease({ ...options, ...change })).rejects.toThrow();
  if (process.platform !== 'win32') {
    const link = path.join(temporary(), 'linked-source');
    symlinkSync(f.root, link);
    await expect(
      stageRelease({ ...options, output: path.join(link, 'stage') }),
    ).rejects.toThrow('outside');
  }
  expect(existsSync(options.output)).toBe(false);
  expect(existsSync(path.join(f.root, '.tale'))).toBe(false);
  await expect(
    buildRelease({
      ...f.options,
      version: undefined,
      sourceCommit: f.git('rev-parse', 'HEAD^{tree}'),
      output: temporary(),
    }),
  ).rejects.toThrow('commit object');
  const release = await buildRelease({
    ...f.options,
    version: undefined,
    output: temporary(),
  });
  const context = loadClient(f.descriptorPath, f.name);
  for (const change of [
    { releaseRef: 'f'.repeat(40) },
    { sourceCommit: 'f'.repeat(40) },
    { version: '1.0.0' },
    { compilerVersion: 2 },
    { releaseRef: f.options.sourceCommit + '\n' },
  ])
    expect(() =>
      validateManifest({ ...release.manifest, ...change }, context),
    ).toThrow();
});
