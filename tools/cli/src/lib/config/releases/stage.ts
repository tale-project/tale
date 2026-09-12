import {
  readFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { committedClient, git } from './git';
import {
  loadClient,
  releaseIdentity,
  repoPath,
  sha256,
  sourcePathSeparators,
} from './identity';
import { loadRelease } from './manifest';
import {
  insist,
  slug,
  version,
  sha,
  gitSha,
  relativePath,
  repository,
  type LoadedRelease,
} from './model';
import { validateNativeRelease } from './native';
import {
  buildRelease,
  createImmutable,
  verifyArtifact,
  type NativeValidator,
} from './release';

const common = {
  clientId: slug,
  automationName: slug,
  descriptorPath: z.literal('client.json'),
  manifestPath: relativePath,
  files: z
    .array(
      z.strictObject({
        path: relativePath,
        sha256: sha,
        bytes: z.number().int().nonnegative().safe(),
      }),
    )
    .min(2),
};
const stageSchema = z.discriminatedUnion('schemaVersion', [
  z.strictObject({
    ...common,
    schemaVersion: z.literal(1),
    opsCommit: gitSha,
    catalogueRepository: repository,
    catalogueCommit: gitSha,
    configVersion: version,
    sourceCommit: gitSha.optional(),
    artifactSha256: sha.optional(),
  }),
  z.strictObject({
    ...common,
    schemaVersion: z.literal(2),
    releaseRef: gitSha,
    sourceCommit: gitSha,
    sourceRepository: repository,
    artifactSha256: sha,
    deploymentRef: gitSha.optional(),
  }),
]);

export interface StageOptions {
  repoRoot: string;
  descriptorPath: string;
  automationName: string;
  version?: string;
  configRef?: string;
  catalogueCommit?: string;
  catalogueRepository?: string;
  clientId?: string;
  opsCommit?: string;
  deploymentRef?: string;
  skillOwnerUserId?: string;
  output: string;
  validateNative?: NativeValidator;
}
export type StageReceipt = z.infer<typeof stageSchema>;
export interface StageExpectations {
  clientId?: string;
  automationName?: string;
  configVersion?: string;
  catalogueCommit?: string;
  catalogueRepository?: string;
  opsCommit?: string;
  releaseRef?: string;
  sourceCommit?: string;
  sourceRepository?: string;
  artifactSha256?: string;
  deploymentRef?: string;
}

/** Resolve existing parent symlinks before choosing a lock/output location.
 * A source stage must not add artifacts or even lock metadata to its checkout. */
export function stageOutputDirectory(repoRoot: string, output: string): string {
  let ancestor = path.resolve(output);
  const absent: string[] = [];
  while (!existsSync(ancestor)) {
    absent.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  const resolved = path.join(realpathSync(ancestor), ...absent);
  const relative = path.relative(realpathSync(repoRoot), resolved);
  insist(
    relative.startsWith('..' + path.sep) ||
      relative === '..' ||
      path.isAbsolute(relative),
    'stage output must be outside the source checkout',
  );
  return resolved;
}

type StagedFile = { path: string; bytes: Buffer; sha256: string };
function selectedFiles(
  release: LoadedRelease,
  directory: string,
  manifestPath: string,
  descriptorBytes: Buffer,
): StagedFile[] {
  const artifacts = [
    release.manifest.artifact,
    ...(release.manifest.installArtifacts
      ? [
          release.manifest.installArtifacts.workflow,
          ...release.manifest.installArtifacts.skills,
        ]
      : []),
  ];
  const paths = [
    repoPath(directory, manifestPath),
    ...artifacts.map((artifact) =>
      repoPath(
        directory,
        path.resolve(path.dirname(manifestPath), artifact.path),
      ),
    ),
    ...(release.historical ? [release.historical.sourceArchive.path] : []),
  ];
  insist(
    new Set(['client.json', ...paths]).size === paths.length + 1,
    'staged file identities overlap',
  );
  return [
    {
      path: 'client.json',
      bytes: descriptorBytes,
      sha256: sha256(descriptorBytes),
    },
    ...paths.map((relative) => {
      const bytes = readFileSync(path.join(directory, relative));
      return { path: relative, bytes, sha256: sha256(bytes) };
    }),
  ];
}
type StageMetadata = StageReceipt extends infer R
  ? R extends StageReceipt
    ? Omit<R, 'files'>
    : never
  : never;
function publish(
  output: string,
  metadata: StageMetadata,
  files: StagedFile[],
): StageReceipt {
  const receipt = stageSchema.parse({
    ...metadata,
    files: files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes.length,
    })),
  });
  mkdirSync(output, { recursive: true });
  for (const file of files) {
    const target = path.join(output, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    createImmutable(target, file.bytes);
  }
  createImmutable(
    path.join(output, 'deployment.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  return receipt;
}

/** Publish an already verified SHA release without reacquiring Git sources.
 * Native late-owner compilation uses the same stage layout and receipt. */
export function stageBuiltRelease(options: {
  output: string;
  directory: string;
  manifestPath: string;
  descriptorBytes: Buffer;
  release: LoadedRelease;
  deploymentRef?: string;
}): StageReceipt {
  const { release } = options;
  insist(
    release.manifest.schemaVersion === 4,
    'source stage requires a SHA release',
  );
  return publish(
    options.output,
    {
      schemaVersion: 2,
      releaseRef: gitSha.parse(release.manifest.releaseRef),
      sourceCommit: release.manifest.sourceCommit,
      sourceRepository: repository.parse(release.manifest.sourceRepository),
      artifactSha256: release.manifest.artifact.sha256,
      ...(options.deploymentRef === undefined
        ? {}
        : { deploymentRef: gitSha.parse(options.deploymentRef) }),
      clientId: slug.parse(release.manifest.clientId),
      automationName: release.manifest.automationName,
      descriptorPath: 'client.json',
      manifestPath: repoPath(options.directory, options.manifestPath),
    },
    selectedFiles(
      release,
      options.directory,
      options.manifestPath,
      options.descriptorBytes,
    ),
  );
}

/** SHA mode has no generated catalogue commit: build and independently rebuild
 * from committed blobs in owned temporary storage, then transfer only verified
 * descriptor/artifact bytes. Compatibility mode keeps its committed catalogue. */
export async function stageRelease(
  options: StageOptions,
): Promise<StageReceipt> {
  insist(
    (options.configRef === undefined) !== (options.version === undefined),
    'select exactly one config ref or compatibility version',
  );
  const output = stageOutputDirectory(options.repoRoot, options.output);
  const descriptorPath = path.resolve(
    options.repoRoot,
    relativePath.parse(sourcePathSeparators(options.descriptorPath)),
  );
  const catalogueCommit = gitSha.parse(
    options.catalogueCommit ?? options.configRef,
  );
  if (options.configRef !== undefined) {
    insist(
      gitSha.parse(options.configRef) === catalogueCommit,
      'config ref differs from the exact source checkout commit',
    );
    insist(
      options.opsCommit === undefined,
      'SHA stages use deploymentRef instead of opsCommit',
    );
  } else {
    insist(
      options.deploymentRef === undefined,
      'compatibility stages use opsCommit instead of deploymentRef',
    );
  }
  insist(
    git(options.repoRoot, 'rev-parse', 'HEAD').toString('utf8').trim() ===
      catalogueCommit,
    'client checkout differs from the exact catalogue commit',
  );
  const source = committedClient(
    options.repoRoot,
    descriptorPath,
    options.automationName,
    catalogueCommit,
  );
  const { context } = source;
  insist(
    (options.clientId === undefined ||
      context.client.clientId === options.clientId) &&
      (options.catalogueRepository === undefined ||
        context.client.sourceRepository === options.catalogueRepository),
    'client source/identity differs from deployment declaration',
  );
  const validateNative = options.validateNative ?? validateNativeRelease;
  if (options.configRef !== undefined) {
    const deploymentRef =
      options.deploymentRef === undefined
        ? undefined
        : gitSha.parse(options.deploymentRef);
    const temporary = mkdtempSync(path.join(tmpdir(), 'tale-config-stage-'));
    try {
      // The verification descriptor is the exact source blob, never a dirty
      // checkout file. Its original path remains in manifest provenance.
      const stagedDescriptor = path.join(temporary, 'client.json');
      createImmutable(stagedDescriptor, source.bytes);
      const releases = path.join(temporary, context.automation.releasesPath);
      const built = await buildRelease({
        repoRoot: options.repoRoot,
        descriptorPath,
        automationName: options.automationName,
        sourceCommit: catalogueCommit,
        skillOwnerUserId: options.skillOwnerUserId,
        output: releases,
        validateNative,
      });
      const manifestPath = path.join(releases, catalogueCommit + '.json');
      const release = await verifyArtifact({
        repoRoot: options.repoRoot,
        descriptorPath: stagedDescriptor,
        automationName: options.automationName,
        manifestPath,
        rebuild: true,
        validateNative,
      });
      insist(
        release.bytes.equals(built.bytes),
        'stage source rebuild changed artifact',
      );
      return stageBuiltRelease({
        output,
        directory: temporary,
        manifestPath,
        descriptorBytes: source.bytes,
        release,
        deploymentRef,
      });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  const opsCommit = gitSha.parse(options.opsCommit);
  const catalogueRepository = repository.parse(options.catalogueRepository);
  const configVersion = version.parse(options.version);
  const directory = path.dirname(descriptorPath);
  const manifestPath = path.resolve(
    directory,
    context.automation.releasesPath,
    configVersion + '.json',
  );
  const release = await verifyArtifact({
    repoRoot: options.repoRoot,
    descriptorPath,
    automationName: options.automationName,
    manifestPath,
    rebuild: true,
    validateNative,
  });
  const files = selectedFiles(
    release,
    directory,
    manifestPath,
    readFileSync(descriptorPath),
  );
  for (const file of files) {
    const absolute =
      file.path === 'client.json'
        ? descriptorPath
        : path.join(directory, file.path);
    insist(
      git(
        options.repoRoot,
        'show',
        catalogueCommit + ':' + repoPath(options.repoRoot, absolute),
      ).equals(file.bytes),
      'deployment input differs from committed client catalogue',
    );
  }
  return publish(
    output,
    {
      schemaVersion: 1,
      opsCommit,
      catalogueCommit,
      catalogueRepository,
      clientId: context.client.clientId,
      automationName: options.automationName,
      configVersion,
      sourceCommit: release.manifest.sourceCommit,
      artifactSha256: release.manifest.artifact.sha256,
      descriptorPath: 'client.json',
      manifestPath: repoPath(directory, manifestPath),
    },
    files,
  );
}

export function verifyStage(
  directory: string,
  expected: StageExpectations = {},
) {
  const receipt = stageSchema.parse(
    JSON.parse(readFileSync(path.join(directory, 'deployment.json'), 'utf8')),
  );
  for (const [key, value] of Object.entries(expected)) {
    insist(
      value === undefined ||
        (receipt as Record<string, unknown>)[key] === value,
      'staged ' + key + ' differs from expected deployment',
    );
  }
  insist(
    new Set(receipt.files.map((file) => file.path)).size ===
      receipt.files.length,
    'duplicate staged file identity',
  );
  for (const file of receipt.files) {
    const bytes = readFileSync(path.join(directory, file.path));
    insist(
      bytes.length === file.bytes && sha256(bytes) === file.sha256,
      'staged client content differs from verified catalogue',
    );
  }
  insist(
    receipt.files.some((file) => file.path === receipt.descriptorPath) &&
      receipt.files.some((file) => file.path === receipt.manifestPath),
    'staged descriptor/manifest proof missing',
  );
  const context = loadClient(
    path.join(directory, receipt.descriptorPath),
    receipt.automationName,
  );
  const release = loadRelease(
    path.join(directory, receipt.manifestPath),
    context,
  );
  insist(
    context.client.clientId === receipt.clientId &&
      (receipt.schemaVersion === 1
        ? context.client.sourceRepository === receipt.catalogueRepository &&
          release.manifest.schemaVersion !== 4 &&
          releaseIdentity(release.manifest) === receipt.configVersion
        : context.client.sourceRepository === receipt.sourceRepository &&
          release.manifest.schemaVersion === 4 &&
          releaseIdentity(release.manifest) === receipt.releaseRef &&
          receipt.releaseRef === receipt.sourceCommit),
    'staged release identity differs from deployment receipt',
  );
  insist(
    (receipt.sourceCommit === undefined ||
      receipt.sourceCommit === release.manifest.sourceCommit) &&
      (receipt.artifactSha256 === undefined ||
        receipt.artifactSha256 === release.manifest.artifact.sha256),
    'staged source/artifact provenance differs from deployment receipt',
  );
  return {
    ...receipt,
    descriptorPath: path.join(directory, receipt.descriptorPath),
    manifestPath: path.join(directory, receipt.manifestPath),
  };
}
