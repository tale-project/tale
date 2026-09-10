import { expect, test } from 'bun:test';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { verifyArtifactBytes } from './artifacts';
import { compile } from './compiler';
import { committedEntries } from './git';
import { releaseIdentity, sha256 } from './identity';
import { stageRelease, verifyStage } from './stage';
import { commandRelease } from './tests/command-fixture';
import { temporary } from './tests/fixture';
import { historicalFixture } from './tests/legacy-fixture';

test('separate client repositories stage exact committed bytes and arbitrary descriptor basenames', async () => {
  for (const [client, owned] of [
    ['acme', true],
    ['north-labs', false],
  ] as const) {
    const f = await commandRelease(client, owned);
    const descriptor = path.join(f.directory, 'customer.json');
    renameSync(f.descriptorPath, descriptor);
    const options = {
      ...f.stageOptions,
      descriptorPath: path.relative(f.root, descriptor),
      catalogueCommit: f.commit(),
    };
    const receipt = await stageRelease(options);
    expect(await stageRelease(options)).toEqual(receipt);
    const verified = verifyStage(options.output, {
      clientId: client,
      catalogueCommit: options.catalogueCommit,
    });
    expect(readFileSync(verified.descriptorPath)).toEqual(
      readFileSync(descriptor),
    );
    expect(
      receipt.files.some(
        (file) => file.path.includes('.git/') || file.path.includes('packs/'),
      ),
    ).toBe(false);
    expect(() =>
      verifyStage(options.output, { configVersion: '9.9.9' }),
    ).toThrow('differs from expected');
    writeFileSync(verified.manifestPath, 'changed');
    expect(() => verifyStage(options.output)).toThrow(
      'differs from verified catalogue',
    );
  }
});

test('historical stages rebuild offline and retain their original repository declaration', async () => {
  for (const schema of [1, 2] as const) {
    const f = await historicalFixture(schema);
    f.git('add', '--all');
    f.git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'historical catalogue',
    );
    const options = {
      repoRoot: f.root,
      descriptorPath: path.relative(f.root, f.descriptorPath),
      automationName: f.name,
      version: f.release.manifest.version,
      catalogueCommit: f.git('rev-parse', 'HEAD'),
      catalogueRepository: JSON.parse(readFileSync(f.descriptorPath, 'utf8'))
        .sourceRepository,
      clientId: 'legacy',
      opsCommit: 'b'.repeat(40),
      output: path.join(temporary(), 'stage'),
      validateNative: verifyArtifactBytes,
    };
    const receipt = await stageRelease(options);
    expect(receipt.files.some((file) => file.path.includes('/sources/'))).toBe(
      true,
    );
    const verified = verifyStage(options.output);
    expect(verified.schemaVersion === 1 && verified.catalogueRepository).toBe(
      options.catalogueRepository,
    );
  }
});

test('a self-consistent forged catalogue cannot claim unchanged source provenance', async () => {
  const f = await commandRelease('north-labs', false);
  const original = f.release.manifest;
  const entries = committedEntries(
    f.root,
    original.sourceCommit,
    original.packPath,
  );
  const document = entries.find((entry) => entry.path === 'workflow.yml')!;
  document.bytes = Buffer.from(
    document.bytes.toString().replace('received: true', 'received: false'),
  );
  const forged = await compile(
    entries,
    f.descriptor.automations[0],
    releaseIdentity(original),
  );
  const artifact = (previous: { path: string }, bytes: Buffer) => ({
    path: previous.path,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
  const manifest = {
    ...original,
    documentSha256: forged.documentSha256,
    artifact: artifact(original.artifact, forged.canonical),
    installArtifacts: {
      ...original.installArtifacts!,
      workflow: artifact(original.installArtifacts!.workflow, forged.workflow),
    },
  };
  writeFileSync(f.release.artifactPath, forged.canonical);
  writeFileSync(f.release.installation!.workflow.artifactPath, forged.workflow);
  writeFileSync(f.manifestPath, JSON.stringify(manifest));
  await expect(
    stageRelease({ ...f.stageOptions, catalogueCommit: f.commit() }),
  ).rejects.toThrow('rebuild differs');
});

test('stage metadata, working-tree edits and duplicate identities fail before native authentication', async () => {
  const f = await commandRelease();
  await expect(
    stageRelease({ ...f.stageOptions, catalogueCommit: 'f'.repeat(40) }),
  ).rejects.toThrow('checkout differs');
  await expect(
    stageRelease({ ...f.stageOptions, clientId: 'foreign' }),
  ).rejects.toThrow('identity differs');
  const receipt = await stageRelease(f.stageOptions);
  const receiptPath = path.join(f.stageOptions.output, 'deployment.json');
  writeFileSync(
    receiptPath,
    JSON.stringify({ ...receipt, files: [...receipt.files, receipt.files[0]] }),
  );
  expect(() => verifyStage(f.stageOptions.output)).toThrow('duplicate');
  writeFileSync(
    receiptPath,
    JSON.stringify({ ...receipt, configVersion: '9.9.9' }),
  );
  expect(() => verifyStage(f.stageOptions.output)).toThrow('identity differs');
  writeFileSync(
    f.descriptorPath,
    `${readFileSync(f.descriptorPath, 'utf8')}\n`,
  );
  await expect(
    stageRelease({
      ...f.stageOptions,
      output: path.join(temporary(), 'other'),
    }),
  ).rejects.toThrow('committed client catalogue');
});
