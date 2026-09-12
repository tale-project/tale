import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { archive, unpack } from '../config/releases/archive';
import {
  committedClient,
  committedEntries,
  git,
  treeHash,
} from '../config/releases/git';
import {
  parseClient,
  sha256,
  sourcePackPath,
} from '../config/releases/identity';
import {
  gitSha,
  insist,
  owner,
  relativePath,
  repository,
  sha,
  slug,
} from '../config/releases/model';
import { validateNativeRelease } from '../config/releases/native';
import {
  buildReleaseFromSource,
  createImmutable,
  type NativeValidator,
  type ReleaseSourceSnapshot,
} from '../config/releases/release';
import { gitTreeHash } from '../config/releases/snapshot';
import {
  stageBuiltRelease,
  stageOutputDirectory,
  stageRelease,
  verifyStage,
  type StageExpectations,
  type StageOptions,
} from '../config/releases/stage';

const CAPTURE = 'source-capsule.json';
const FILES = [CAPTURE, 'client.json', 'source.zip'].sort();
const fileProof = z.strictObject({
  path: relativePath,
  sha256: sha,
  bytes: z.number().int().nonnegative().max(25_000_000),
  executable: z.boolean(),
});
export const sourceCapsuleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-config-source'),
  clientId: slug,
  automationName: slug,
  releaseRef: gitSha,
  sourceCommit: gitSha,
  sourceRepository: repository,
  deploymentRef: gitSha.optional(),
  descriptorPath: relativePath,
  descriptorSha256: sha,
  packPath: relativePath,
  packTree: gitSha,
  archiveSha256: sha,
  archiveBytes: z.number().int().positive().max(110_000_000),
  files: z.array(fileProof).min(1).max(5000),
});
export type SourceCapsuleReceipt = z.infer<typeof sourceCapsuleSchema>;
export type PrepareDeploymentConfigOptions = StageOptions & {
  lateOwner?: boolean;
};
export type PreparedDeploymentConfig =
  | { kind: 'release'; stage: ReturnType<typeof verifyStage> }
  | {
      kind: 'source';
      receipt: SourceCapsuleReceipt;
      capsuleSha256: string;
      source: ReleaseSourceSnapshot;
    };

function boundedFile(file: string, maximum: number): Buffer {
  const stat = lstatSync(file);
  insist(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum,
    'invalid source capsule file',
  );
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(handle);
    insist(
      before.isFile() && before.ino === stat.ino && before.size === stat.size,
      'source capsule file changed while opening',
    );
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    for (;;) {
      const read = readSync(handle, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
      insist(count <= before.size, 'source capsule file grew while reading');
    }
    const after = fstatSync(handle);
    insist(
      count === before.size &&
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs &&
        after.ctimeMs === before.ctimeMs,
      'source capsule file changed while reading',
    );
    return bytes.subarray(0, count);
  } finally {
    closeSync(handle);
  }
}

/** The outer managed bundle proves who prepared this committed subset. This
 * verifier proves its complete portable pack tree again without Git or hooks. */
export async function verifyPreparedDeploymentConfig(
  directory: string,
  expected: StageExpectations = {},
): Promise<PreparedDeploymentConfig> {
  const names = readdirSync(directory).sort();
  if (!names.includes(CAPTURE))
    return { kind: 'release', stage: verifyStage(directory, expected) };
  insist(
    JSON.stringify(names) === JSON.stringify(FILES),
    'source capsule has missing or unexpected files',
  );
  const raw = boundedFile(path.join(directory, CAPTURE), 2_000_000);
  const receipt = sourceCapsuleSchema.parse(JSON.parse(raw.toString('utf8')));
  insist(
    raw.toString('utf8') === `${JSON.stringify(receipt, null, 2)}\n`,
    'source capsule metadata is not canonical',
  );
  insist(
    receipt.releaseRef === receipt.sourceCommit,
    'source capsule release differs from its source',
  );
  for (const [key, value] of Object.entries(expected))
    insist(
      value === undefined ||
        (receipt as Record<string, unknown>)[key] === value,
      'source capsule ' + key + ' differs from deployment',
    );
  const bytes = boundedFile(path.join(directory, 'client.json'), 1_000_000);
  insist(
    sha256(bytes) === receipt.descriptorSha256,
    'source capsule descriptor differs',
  );
  const context = parseClient(
    bytes.toString('utf8'),
    path.join(directory, 'client.json'),
    receipt.automationName,
  );
  insist(
    context.client.clientId === receipt.clientId &&
      context.client.sourceRepository === receipt.sourceRepository &&
      path.posix.join(
        path.posix.dirname(receipt.descriptorPath),
        context.automation.packPath,
      ) === receipt.packPath,
    'source capsule descriptor identity differs',
  );
  const zipped = boundedFile(path.join(directory, 'source.zip'), 110_000_000);
  insist(
    zipped.length === receipt.archiveBytes &&
      sha256(zipped) === receipt.archiveSha256,
    'source capsule archive differs',
  );
  const entries = await unpack(zipped);
  const files = entries.map((entry) => ({
    path: entry.path,
    sha256: sha256(entry.bytes),
    bytes: entry.bytes.length,
    executable: entry.executable,
  }));
  insist(
    JSON.stringify(files) === JSON.stringify(receipt.files) &&
      gitTreeHash(entries) === receipt.packTree,
    'source capsule pack inventory or Git tree differs',
  );
  return {
    kind: 'source',
    receipt,
    capsuleSha256: sha256(raw),
    source: {
      context,
      bytes,
      descriptorPath: receipt.descriptorPath,
      packPath: receipt.packPath,
      packTree: receipt.packTree,
      entries,
    },
  };
}

/** Existing pinned-owner stages stay byte-identical. Only an explicit late
 * owner transfers source; validation artifacts are temporary and never deploy. */
export async function prepareDeploymentConfig(
  options: PrepareDeploymentConfigOptions,
) {
  if (!options.lateOwner) return stageRelease(options);
  insist(
    options.configRef !== undefined &&
      options.version === undefined &&
      options.opsCommit === undefined &&
      options.skillOwnerUserId === undefined,
    'late owner requires an uncompiled exact SHA source',
  );
  const revision = gitSha.parse(options.configRef);
  insist(
    (options.catalogueCommit === undefined ||
      options.catalogueCommit === revision) &&
      git(options.repoRoot, 'rev-parse', 'HEAD').toString('utf8').trim() ===
        revision,
    'source capsule checkout differs from its exact commit',
  );
  const output = stageOutputDirectory(options.repoRoot, options.output);
  const original = committedClient(
    options.repoRoot,
    path.resolve(options.repoRoot, relativePath.parse(options.descriptorPath)),
    options.automationName,
    revision,
  );
  const { context } = original;
  insist(
    (options.clientId === undefined ||
      context.client.clientId === options.clientId) &&
      (options.catalogueRepository === undefined ||
        context.client.sourceRepository === options.catalogueRepository),
    'source capsule client differs from declaration',
  );
  const packPath = sourcePackPath(options.repoRoot, context);
  const entries = committedEntries(options.repoRoot, revision, packPath);
  const packTree = treeHash(options.repoRoot, revision, packPath);
  const zipped = await archive(entries);
  // Reuse native archive bounds and portable path checks before publication.
  insist(
    gitTreeHash(await unpack(zipped)) === packTree,
    'source capsule archive changed the committed tree',
  );
  const source: ReleaseSourceSnapshot = {
    ...original,
    packPath,
    packTree,
    entries,
  };
  const temporary = mkdtempSync(
    path.join(tmpdir(), 'tale-config-source-check-'),
  );
  try {
    await buildReleaseFromSource(source, {
      sourceCommit: revision,
      output: temporary,
      skillOwnerUserId: 'source-validation-only',
      validateNative: options.validateNative ?? validateNativeRelease,
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  const receipt = sourceCapsuleSchema.parse({
    schemaVersion: 1,
    kind: 'tale-config-source',
    clientId: context.client.clientId,
    automationName: context.automation.name,
    releaseRef: revision,
    sourceCommit: revision,
    sourceRepository: context.client.sourceRepository,
    deploymentRef: options.deploymentRef,
    descriptorPath: original.descriptorPath,
    descriptorSha256: sha256(original.bytes),
    packPath,
    packTree,
    archiveSha256: sha256(zipped),
    archiveBytes: zipped.length,
    files: [...entries]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((entry) => ({
        path: entry.path,
        sha256: sha256(entry.bytes),
        bytes: entry.bytes.length,
        executable: entry.executable,
      })),
  });
  mkdirSync(output, { recursive: true });
  createImmutable(path.join(output, 'client.json'), original.bytes);
  createImmutable(path.join(output, 'source.zip'), zipped);
  createImmutable(
    path.join(output, CAPTURE),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await verifyPreparedDeploymentConfig(output);
  return receipt;
}

/** Called after a native session proves the actual operator, using retained
 * private staging. Replays never replace an existing artifact with new bytes. */
export async function buildCapsuleStage(
  directory: string,
  output: string,
  skillOwnerUserId: string,
  expected: StageExpectations = {},
  validateNative: NativeValidator = validateNativeRelease,
) {
  const verified = await verifyPreparedDeploymentConfig(directory, expected);
  insist(
    verified.kind === 'source',
    'late-owner compilation requires a source capsule',
  );
  const destination = stageOutputDirectory(directory, output);
  const releases = path.join(
    destination,
    verified.source.context.automation.releasesPath,
  );
  const release = await buildReleaseFromSource(verified.source, {
    sourceCommit: verified.receipt.sourceCommit,
    output: releases,
    skillOwnerUserId: owner.parse(skillOwnerUserId),
    validateNative,
  });
  const manifestPath = path.join(
    releases,
    `${verified.receipt.releaseRef}.json`,
  );
  stageBuiltRelease({
    output: destination,
    directory: destination,
    manifestPath,
    descriptorBytes: verified.source.bytes,
    release,
    deploymentRef: verified.receipt.deploymentRef,
  });
  return verifyStage(destination, expected);
}
