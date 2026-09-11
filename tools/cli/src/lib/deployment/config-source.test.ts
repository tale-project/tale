import { expect, test } from 'bun:test';
import {
  cpSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { archive, unpack } from '../config/releases/archive';
import { verifyArtifactBytes } from '../config/releases/artifacts';
import { sha256 } from '../config/releases/identity';
import { stageRelease, verifyStage } from '../config/releases/stage';
import { fixture, temporary } from '../config/releases/tests/fixture';
import {
  buildCapsuleStage,
  prepareDeploymentConfig,
  sourceCapsuleSchema,
  verifyPreparedDeploymentConfig,
} from './config-source';

async function capsule(client = 'north-labs', skills = ['invoice']) {
  const f = fixture(client, skills, ['pdf']);
  const output = path.join(temporary(), 'source');
  const options = {
    repoRoot: f.root,
    descriptorPath: path.relative(f.root, f.descriptorPath),
    automationName: f.name,
    configRef: f.options.sourceCommit,
    catalogueRepository: f.descriptor.sourceRepository,
    clientId: client,
    deploymentRef: 'd'.repeat(40),
    output,
    lateOwner: true,
    validateNative: verifyArtifactBytes,
  };
  const receipt = sourceCapsuleSchema.parse(
    await prepareDeploymentConfig(options),
  );
  return { f, output, options, receipt };
}

test('Git and detached capsule use identical full SHA manifest, canonical and companion bytes', async () => {
  for (const [client, skills] of [
    ['north-labs', ['invoice']],
    ['second-client', ['invoice', 'invoice-tools']],
  ] as const) {
    const unit = await capsule(client, [...skills]);
    const operator = 'fresh_verified_operator';
    const original = path.join(temporary(), 'git-stage');
    const expected = await stageRelease({
      ...unit.options,
      output: original,
      skillOwnerUserId: operator,
    });
    // The detached build has no access to Git or the original checkout.
    rmSync(unit.f.root, { recursive: true });
    const output = path.join(temporary(), 'native-stage');
    const built = await buildCapsuleStage(
      unit.output,
      output,
      operator,
      {},
      verifyArtifactBytes,
    );
    expect(
      JSON.parse(readFileSync(path.join(output, 'deployment.json'), 'utf8')),
    ).toEqual(expected);
    for (const file of expected.files)
      expect(readFileSync(path.join(output, file.path))).toEqual(
        readFileSync(path.join(original, file.path)),
      );
    expect(
      JSON.parse(readFileSync(built.manifestPath, 'utf8')).skillOwnerUserId,
    ).toBe(operator);
    expect((await verifyPreparedDeploymentConfig(output)).kind).toBe('release');
    expect(
      await buildCapsuleStage(
        unit.output,
        output,
        operator,
        {},
        verifyArtifactBytes,
      ),
    ).toEqual(built);
    await expect(
      buildCapsuleStage(
        unit.output,
        output,
        'another_operator',
        {},
        verifyArtifactBytes,
      ),
    ).rejects.toThrow('refusing to replace');
  }
}, 30_000);

test('late-owner preparation retains only bounded source data and refuses ambiguous preparation', async () => {
  const unit = await capsule();
  expect(readdirSync(unit.output).sort()).toEqual([
    'client.json',
    'source-capsule.json',
    'source.zip',
  ]);
  expect(
    readFileSync(path.join(unit.output, 'source.zip')).includes(
      'source-validation-only',
    ),
  ).toBe(false);
  expect(await prepareDeploymentConfig(unit.options)).toEqual(unit.receipt);
  for (const change of [
    { skillOwnerUserId: 'native_owner_test' },
    { version: '1.2.3' },
    { configRef: undefined },
    { configRef: 'f'.repeat(40) },
    { clientId: 'wrong' },
  ])
    await expect(
      prepareDeploymentConfig({ ...unit.options, ...change }),
    ).rejects.toThrow();
  await expect(
    buildCapsuleStage(
      unit.output,
      unit.output,
      'native_owner_test',
      {},
      verifyArtifactBytes,
    ),
  ).rejects.toThrow('outside');
  const normal = path.join(temporary(), 'normal');
  await prepareDeploymentConfig({
    ...unit.options,
    lateOwner: false,
    skillOwnerUserId: 'native_owner_test',
    output: normal,
  });
  expect(verifyStage(normal).sourceCommit).toBe(unit.receipt.sourceCommit);
}, 30_000);

test('capsule missing/extra files, descriptor, source and pack custody corruption refuse', async () => {
  const unit = await capsule();
  for (const failure of [
    'missing',
    'extra',
    'descriptor',
    'archive',
    'source',
    'tree',
    'duplicate',
    'unsafe',
    'identity',
  ]) {
    const output = path.join(temporary(), 'changed');
    cpSync(unit.output, output, { recursive: true });
    if (failure === 'missing') rmSync(path.join(output, 'source.zip'));
    if (failure === 'extra')
      writeFileSync(path.join(output, 'hook.sh'), 'unreviewed');
    if (failure === 'descriptor')
      writeFileSync(path.join(output, 'client.json'), '{}');
    if (failure === 'archive')
      writeFileSync(path.join(output, 'source.zip'), 'corrupt');
    const receipt = structuredClone(unit.receipt);
    if (failure === 'source') receipt.sourceCommit = 'f'.repeat(40);
    if (failure === 'tree') receipt.packTree = 'f'.repeat(40);
    if (failure === 'duplicate') receipt.files.push(receipt.files[0]!);
    if (failure === 'unsafe') receipt.files[0]!.path = '../escape';
    if (failure === 'identity') receipt.clientId = 'another-client';
    writeFileSync(
      path.join(output, 'source-capsule.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    await expect(verifyPreparedDeploymentConfig(output)).rejects.toThrow();
  }
  for (const expected of [
    { sourceRepository: 'https://github.com/other/client' },
    { releaseRef: 'f'.repeat(40) },
    { automationName: 'another' },
    { deploymentRef: 'f'.repeat(40) },
  ])
    await expect(
      verifyPreparedDeploymentConfig(unit.output, expected),
    ).rejects.toThrow('differs');
}, 30_000);

test('a self-consistent changed archive still cannot claim the original Git pack tree', async () => {
  const unit = await capsule();
  const entries = await unpack(
    readFileSync(path.join(unit.output, 'source.zip')),
  );
  entries[0]!.bytes = Buffer.from('changed exact source');
  const bytes = await archive(entries);
  const receipt = {
    ...unit.receipt,
    archiveSha256: sha256(bytes),
    archiveBytes: bytes.length,
    files: entries.map((entry) => ({
      path: entry.path,
      sha256: sha256(entry.bytes),
      bytes: entry.bytes.length,
      executable: entry.executable,
    })),
  };
  writeFileSync(path.join(unit.output, 'source.zip'), bytes);
  writeFileSync(
    path.join(unit.output, 'source-capsule.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await expect(verifyPreparedDeploymentConfig(unit.output)).rejects.toThrow(
    'Git tree',
  );
});
