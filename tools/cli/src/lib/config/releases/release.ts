import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  linkSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';

import type { Entry } from './archive';
import { verifyArtifactBytes } from './artifacts';
import { compile } from './compiler';
import { committedClient, committedEntries, treeHash } from './git';
import {
  loadClient,
  parseClient,
  releaseIdentity,
  sha256,
  sourcePackPath,
} from './identity';
import { rebuildHistorical } from './legacy';
import { loadRelease, validateManifest } from './manifest';
import {
  insist,
  version,
  gitSha,
  relativePath,
  type Artifact,
  type ClientAutomation,
  type LoadedRelease,
} from './model';
import { gitTreeHash, historicalSource } from './snapshot';

export type NativeValidator = (release: LoadedRelease) => Promise<void>;
export interface BuildOptions {
  repoRoot: string;
  descriptorPath: string;
  automationName: string;
  sourceCommit: string;
  version?: string;
  output?: string;
  skillOwnerUserId?: string;
  validateNative: NativeValidator;
}
/** Publish complete bytes by an exclusive link. A crash can leave an owned
 * temporary file or complete companions, never a truncated immutable target;
 * the manifest is published last and identical replay can finish the release. */
export function createImmutable(
  file: string,
  bytes: string | Buffer,
  write: (fd: number, content: Buffer) => void = writeFileSync,
): void {
  const content = Buffer.from(bytes);
  const temporary = `${file}.tmp.${randomUUID()}`;
  const fd = openSync(temporary, 'wx', 0o644);
  try {
    try {
      write(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, file);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          error.code === 'EEXIST'
        ) ||
        !readFileSync(file).equals(content)
      )
        throw new Error('refusing to replace existing release', {
          cause: error,
        });
    }
  } finally {
    unlinkSync(temporary);
  }
}
export async function buildRelease(
  options: BuildOptions,
): Promise<LoadedRelease> {
  const source = committedClient(
    options.repoRoot,
    options.descriptorPath,
    options.automationName,
    options.sourceCommit,
  );
  const context = source.context;
  const packPath = sourcePackPath(options.repoRoot, context);
  const packTree = treeHash(options.repoRoot, options.sourceCommit, packPath);
  return buildReleaseFromSource(
    {
      ...source,
      packPath,
      packTree,
      entries: committedEntries(
        options.repoRoot,
        options.sourceCommit,
        packPath,
      ),
    },
    options,
  );
}

export interface ReleaseSourceSnapshot {
  context: ClientAutomation;
  bytes: Buffer;
  descriptorPath: string;
  packPath: string;
  packTree: string;
  entries: Entry[];
}

/** One compiler for Git preparation and verified managed source capsules.
 * Detached input proves exact descriptor/pack bytes and Git tree identity; the
 * original commit is provenance verified when the outer bundle was prepared. */
export async function buildReleaseFromSource(
  source: ReleaseSourceSnapshot,
  options: Pick<
    BuildOptions,
    | 'sourceCommit'
    | 'version'
    | 'output'
    | 'skillOwnerUserId'
    | 'validateNative'
  >,
): Promise<LoadedRelease> {
  gitSha.parse(options.sourceCommit);
  const identity =
    options.version === undefined
      ? options.sourceCommit
      : version.parse(options.version);
  const context = parseClient(
    source.bytes.toString('utf8'),
    source.context.descriptorPath,
    source.context.automation.name,
  );
  const packPath = relativePath.parse(source.packPath);
  const packTree = gitSha.parse(source.packTree);
  insist(
    path.posix.join(
      path.posix.dirname(relativePath.parse(source.descriptorPath)),
      context.automation.packPath,
    ) === packPath && gitTreeHash(source.entries) === packTree,
    'source snapshot differs from its descriptor or recorded pack tree',
  );
  const compiled = await compile(
    source.entries,
    context.automation,
    identity,
    options.skillOwnerUserId,
  );
  const describe = (suffix: string, bytes: Buffer): Artifact => ({
    path: `${identity}/${context.automation.name}${suffix}.zip`,
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
  const manifest = validateManifest(
    {
      schemaVersion: options.version === undefined ? 4 : 3,
      compilerVersion: options.version === undefined ? 3 : 2,
      ...(options.version === undefined
        ? { releaseRef: identity }
        : { version: identity }),
      sourceRepository: context.client.sourceRepository,
      sourceCommit: options.sourceCommit,
      packPath,
      packTree,
      clientId: context.client.clientId,
      descriptorPath: source.descriptorPath,
      descriptorSha256: sha256(source.bytes),
      automationName: context.automation.name,
      displayName: context.automation.displayName,
      skillOwnerUserId: options.skillOwnerUserId,
      skillBindings: compiled.skillBindings,
      requiredExternalSkills: context.automation.requiredExternalSkills,
      artifact: describe('', compiled.canonical),
      installArtifacts: {
        workflow: describe('.workflow', compiled.workflow),
        skills: compiled.skills.map((skill) => ({
          slug: skill.slug,
          ...describe(`.${skill.slug}.skill`, skill.bytes),
        })),
      },
      documentSha256: compiled.documentSha256,
      settingsSha256: compiled.settingsSha256,
      presentationSha256: compiled.presentationSha256,
      taskContractSha256: compiled.taskContractSha256,
      skillSlugs: compiled.skillBindings.map((binding) => binding.releaseSlug),
      skillFiles: compiled.skillFiles,
    },
    context,
  );
  const directory =
    options.output === undefined
      ? path.resolve(
          path.dirname(context.descriptorPath),
          context.automation.releasesPath,
        )
      : path.resolve(options.output);
  const artifacts = manifest.installArtifacts;
  insist(artifacts, 'compiled release installation metadata missing');
  const installation = {
    workflow: {
      bytes: compiled.workflow,
      artifactPath: path.join(directory, artifacts.workflow.path),
    },
    skills: compiled.skills.map((skill, index) => {
      const artifact = artifacts.skills[index];
      insist(artifact, 'compiled skill artifact metadata missing');
      return {
        slug: skill.slug,
        bytes: skill.bytes,
        artifactPath: path.join(directory, artifact.path),
      };
    }),
  };
  const release: LoadedRelease = {
    manifest,
    bytes: compiled.canonical,
    artifactPath: path.join(directory, manifest.artifact.path),
    installation,
  };
  await verifyArtifactBytes(release);
  await options.validateNative(release);
  mkdirSync(path.join(directory, identity), { recursive: true });
  for (const artifact of [
    release,
    installation.workflow,
    ...installation.skills,
  ])
    createImmutable(artifact.artifactPath, artifact.bytes);
  createImmutable(
    path.join(directory, `${identity}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return release;
}
export interface VerifyOptions {
  repoRoot: string;
  descriptorPath: string;
  automationName: string;
  manifestPath: string;
  rebuild?: boolean;
  validateNative?: NativeValidator;
}
export async function verifyArtifact(
  options: VerifyOptions,
): Promise<LoadedRelease> {
  const context = loadClient(options.descriptorPath, options.automationName);
  const release = loadRelease(options.manifestPath, context);
  const { manifest } = release;
  const sourceRoot = options.repoRoot;
  let historicEntries;
  if (manifest.schemaVersion >= 3) {
    insist(manifest.descriptorPath, 'release source descriptor missing');
    insist(
      treeHash(sourceRoot, manifest.sourceCommit, manifest.packPath) ===
        manifest.packTree,
      'release source tree differs from recorded commit',
    );
    const source = committedClient(
      sourceRoot,
      path.resolve(sourceRoot, manifest.descriptorPath),
      options.automationName,
      manifest.sourceCommit,
    );
    insist(
      sha256(source.bytes) === manifest.descriptorSha256 &&
        source.context.client.clientId === manifest.clientId &&
        source.context.client.sourceRepository === manifest.sourceRepository,
      'release source descriptor provenance differs',
    );
  } else {
    historicEntries = await historicalSource(context, release);
  }
  await verifyArtifactBytes(release);
  if (options.rebuild) {
    const rebuilt =
      manifest.schemaVersion >= 3
        ? await compile(
            committedEntries(
              sourceRoot,
              manifest.sourceCommit,
              manifest.packPath,
            ),
            context.automation,
            releaseIdentity(manifest),
            manifest.skillOwnerUserId,
          )
        : rebuildHistorical(historicEntries ?? [], manifest, context);
    insist(
      rebuilt.canonical.equals(release.bytes),
      'rebuild differs from canonical artifact',
    );
    if (release.installation) {
      insist(
        rebuilt.workflow?.equals(release.installation.workflow.bytes) &&
          rebuilt.skills?.length === release.installation.skills.length,
        'rebuild differs from installation artifacts',
      );
      for (const skill of release.installation.skills)
        insist(
          rebuilt.skills
            .find((item) => item.slug === skill.slug)
            ?.bytes.equals(skill.bytes),
          'rebuild differs from skill artifact',
        );
    }
  }
  if (options.validateNative) await options.validateNative(release);
  return release;
}
