import { mkdir, readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';

import { stringify } from 'yaml';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { sha256, valueHash } from '../config/releases/identity';
import { gitSha, relativePath, sha } from '../config/releases/model';
import {
  prepareInferenceValue,
  inferenceBundleHash,
  verifyInferenceBundle,
} from '../inference/bundle';
import { boundedJson, writePublicArtifact } from '../inference/files';
import { resolveInferenceSpec } from '../inference/model';
import {
  admittedProofs,
  inferenceCaddyfile,
  inferenceRouterCompose,
  INFERENCE_CADDY_IMAGE,
  INFERENCE_ZEROTIER_IMAGE,
  writeInferenceRouter,
} from '../inference/router';
import { committedInferenceSource } from '../inference/source';
import { resolveValue, type DeploymentSpec } from './model';
import { runtimeCommand } from './runtime-command';
import {
  type RuntimeDependencies,
  type RuntimePlatform,
} from './runtime-model';
import { inspectRuntimeImage } from './runtime-prepare';

export const INFERENCE_IMAGES = [
  {
    repository: 'caddy',
    reference: INFERENCE_CADDY_IMAGE,
    service: 'inference-router',
  },
  {
    repository: 'zyclonite/zerotier',
    reference: INFERENCE_ZEROTIER_IMAGE,
    service: 'inference-overlay',
  },
] as const;
const files = [
  'source.json',
  'model/inference.json',
  'model/runtime-admission.py',
  'router/Caddyfile',
  'router/compose.yml',
  'router/router.json',
  'proofs.json',
] as const;
const metadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('managed-tale-inference'),
  source: z.strictObject({
    repository: z.string(),
    revision: gitSha,
    specPath: relativePath,
    sha256: sha,
  }),
  bundleSha256: sha,
  composeProject: z.string(),
  platform: z.enum(['linux/amd64', 'linux/arm64']),
  files: z
    .array(z.strictObject({ path: z.enum(files), sha256: sha }))
    .length(files.length),
  images: z
    .array(
      z.strictObject({
        repository: z.string(),
        reference: z.string(),
        digest: z.string(),
        platform: z.enum(['linux/amd64', 'linux/arm64']),
      }),
    )
    .length(2),
});
export type ManagedInference = z.infer<typeof metadataSchema>;
export function inferenceProject(spec: DeploymentSpec): string {
  return `${spec.composeProject}-inference`;
}
export function inferenceTopology(spec: DeploymentSpec) {
  if (!spec.inference)
    throw preconditionError('Deployment has no inference declaration.');
  return {
    schemaVersion: 1 as const,
    backendNetwork: `${spec.composeProject}_internal`,
    overlayNetwork: { env: spec.inference.overlayNetwork.env },
  };
}
async function inspectImages(
  platform: RuntimePlatform,
  dependencies: RuntimeDependencies,
) {
  const result = [];
  for (const image of INFERENCE_IMAGES) {
    await runtimeCommand(
      ['pull', '--platform', platform, image.reference],
      dependencies,
      { timeout: 1800 },
    );
    const inspected = await inspectRuntimeImage(
      image.reference,
      image.repository,
      platform,
      null,
      dependencies,
    );
    if (inspected.digest !== image.reference.split('@')[1])
      throw preconditionError(
        'Inference router image differs from the pinned artifact.',
      );
    result.push({
      repository: image.repository,
      reference: image.reference,
      digest: inspected.digest,
      platform,
    });
  }
  return result;
}

/** Read committed client bytes and explicit status receipts, never a dirty
 * working file or an ops-owned duplicate model catalog. No weights are read. */
export async function prepareManagedInference(
  repoRoot: string,
  directory: string,
  spec: DeploymentSpec,
  dependencies: RuntimeDependencies = {},
  environment = process.env,
): Promise<ManagedInference> {
  const selected = spec.inference;
  if (!selected || typeof selected.revision !== 'string')
    throw preconditionError(
      'Inference source requires a resolved full commit.',
    );
  const sourceProof = committedInferenceSource(
    repoRoot,
    selected.repository,
    selected.revision,
    selected.specPath,
  );
  const raw = Buffer.from(sourceProof.content);
  let source: unknown;
  try {
    source = JSON.parse(raw.toString('utf8'));
  } catch {
    throw preconditionError('Inference source is not valid JSON.');
  }
  const resolved = resolveInferenceSpec(source, environment);
  if (resolved.organization !== spec.identity?.slug)
    throw preconditionError(
      'Inference models belong to a different deployment organization.',
    );
  const proofInput: unknown[] = [];
  const proofSources: { sha256: string; base64: string }[] = [];
  for (const reference of selected.readiness) {
    const file = resolveValue(reference.file, environment);
    const parsed = await boundedJson(file);
    const bytes = await readFile(file);
    if (
      bytes.length > 4_194_304 ||
      sha256(bytes) !== reference.sha256 ||
      valueHash(JSON.parse(bytes.toString('utf8'))) !== valueHash(parsed)
    )
      throw preconditionError(
        'Inference status proof differs from its selected SHA-256.',
      );
    proofInput.push(parsed);
    proofSources.push({
      sha256: reference.sha256,
      base64: bytes.toString('base64'),
    });
  }
  const proofs = admittedProofs(
    resolved,
    proofInput,
    Date.now(),
    inferenceBundleHash(resolved, sourceProof),
  );
  await mkdir(directory, { mode: 0o755 });
  await writePublicArtifact(join(directory, 'source.json'), raw);
  const bundle = await prepareInferenceValue(
    resolved,
    join(directory, 'model'),
    environment,
    sourceProof,
  );
  await writeInferenceRouter(
    join(directory, 'router'),
    bundle,
    inferenceTopology(spec),
    proofs,
  );
  await writePublicArtifact(
    join(directory, 'proofs.json'),
    JSON.stringify(proofSources, null, 2) + '\n',
  );
  const metadata = metadataSchema.parse({
    schemaVersion: 1,
    kind: 'managed-tale-inference',
    source: {
      repository: selected.repository,
      revision: selected.revision,
      specPath: selected.specPath,
      sha256: sha256(raw),
    },
    bundleSha256: bundle.bundleSha256,
    composeProject: inferenceProject(spec),
    platform: spec.runtime.platform,
    images: await inspectImages(spec.runtime.platform, dependencies),
    files: await Promise.all(
      files.map(async (path) => ({
        path,
        sha256: sha256(await readFile(join(directory, path))),
      })),
    ),
  });
  await writePublicArtifact(
    join(directory, 'managed.json'),
    JSON.stringify(metadata, null, 2) + '\n',
  );
  await verifyManagedInference(directory, spec);
  return metadata;
}

async function inventory(
  directory: string,
  prefix = '',
  budget = { entries: 0 },
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    if (++budget.entries > 16 || prefix.split('/').length > 2)
      throw preconditionError(
        'Inference bundle has too many entries or nested directories.',
      );
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || entry.name.startsWith('.'))
      throw preconditionError(
        'Inference bundle contains a hidden or linked path.',
      );
    if (entry.isDirectory())
      result.push(...(await inventory(directory, path, budget)));
    else if (entry.isFile()) result.push(path);
    else throw preconditionError('Inference bundle contains a special file.');
    if (result.length > 16)
      throw preconditionError('Inference bundle has too many files.');
  }
  return result.sort();
}

/** Exact source, proof inventory and canonical renderers remain authoritative
 * even if a caller rewrites its surrounding deployment hash. */
export async function verifyManagedInference(
  directory: string,
  spec: DeploymentSpec,
) {
  const selected = spec.inference;
  if (!selected)
    throw preconditionError('Deployment has no inference declaration.');
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    valueHash(await inventory(directory)) !==
      valueHash([...files, 'managed.json'].sort())
  )
    throw preconditionError(
      'Inference bundle inventory differs from the supported companion.',
    );
  const metadata = metadataSchema.parse(
    await boundedJson(join(directory, 'managed.json')),
  );
  if (
    metadata.source.repository !== selected.repository ||
    metadata.source.revision !== selected.revision ||
    metadata.source.specPath !== selected.specPath ||
    metadata.composeProject !== inferenceProject(spec) ||
    metadata.platform !== spec.runtime.platform
  )
    throw preconditionError(
      'Inference companion source or destination differs from the deployment.',
    );
  if (new Set(metadata.files.map((file) => file.path)).size !== files.length)
    throw preconditionError(
      'Inference companion contains duplicate file identities.',
    );
  for (const file of metadata.files)
    if (sha256(await readFile(join(directory, file.path))) !== file.sha256)
      throw preconditionError(
        'Inference companion bytes differ from their recorded SHA-256.',
      );
  const raw = await readFile(join(directory, 'source.json'));
  if (sha256(raw) !== metadata.source.sha256)
    throw preconditionError(
      'Inference source bytes differ from committed source metadata.',
    );
  const bundle = await verifyInferenceBundle(
    join(directory, 'model'),
    metadata.bundleSha256,
  );
  if (
    !bundle.source ||
    bundle.source.content !== raw.toString('utf8') ||
    valueHash({
      repository: bundle.source.repository,
      revision: bundle.source.revision,
      specPath: bundle.source.specPath,
      sha256: bundle.source.sha256,
    }) !== valueHash(metadata.source) ||
    bundle.spec.organization !== spec.identity?.slug
  )
    throw preconditionError(
      'Resolved inference settings differ from the committed client specification.',
    );
  const proofSources = z
    .array(z.strictObject({ sha256: sha, base64: z.string().max(5_592_408) }))
    .max(64)
    .parse(await boundedJson(join(directory, 'proofs.json')));
  if (proofSources.length !== selected.readiness.length)
    throw preconditionError(
      'Inference status proof count differs from the declaration.',
    );
  const rawProofs = proofSources.map((proof, index) => {
    const bytes = Buffer.from(proof.base64, 'base64');
    if (
      bytes.toString('base64') !== proof.base64 ||
      sha256(bytes) !== proof.sha256 ||
      proof.sha256 !== selected.readiness[index]?.sha256
    )
      throw preconditionError(
        'Inference status proof bytes differ from the selected input hash.',
      );
    return JSON.parse(bytes.toString('utf8')) as unknown;
  });
  // Recency is checked during prepare and before a new activation. Verification
  // of a retained artifact remains deterministic across later read-only replay.
  const times = rawProofs.map((proof) =>
    Date.parse(
      z.object({ observedAt: z.string().datetime() }).parse(proof).observedAt,
    ),
  );
  const proofs = admittedProofs(
    bundle.spec,
    rawProofs,
    times.length ? Math.max(...times) : 0,
    bundle.bundleSha256,
  );
  const topology = inferenceTopology(spec);
  if (
    (await readFile(join(directory, 'router/Caddyfile'), 'utf8')) !==
      inferenceCaddyfile(bundle.spec, proofs) ||
    (await readFile(join(directory, 'router/compose.yml'), 'utf8')) !==
      stringify(inferenceRouterCompose(bundle.spec, topology, proofs))
  )
    throw preconditionError(
      'Inference router differs from the exact admitted model routes or network policy.',
    );
  const router = z
    .object({
      bundleSha256: sha,
      topology: z.unknown(),
      admittedNodes: z.array(z.string()),
      proofSha256: z.array(sha),
      caddySha256: sha,
      composeSha256: sha,
    })
    .parse(await boundedJson(join(directory, 'router/router.json')));
  if (
    router.bundleSha256 !== bundle.bundleSha256 ||
    valueHash(router.topology) !== valueHash(topology) ||
    valueHash(router.admittedNodes) !==
      valueHash(proofs.map((proof) => proof.node)) ||
    valueHash(router.proofSha256) !== valueHash(proofs.map(valueHash)) ||
    router.caddySha256 !== sha256(inferenceCaddyfile(bundle.spec, proofs)) ||
    router.composeSha256 !==
      sha256(stringify(inferenceRouterCompose(bundle.spec, topology, proofs)))
  )
    throw preconditionError(
      'Inference router metadata differs from its exact renderer inputs.',
    );
  for (const [index, expected] of INFERENCE_IMAGES.entries()) {
    const image = metadata.images[index];
    if (
      !image ||
      image.repository !== expected.repository ||
      image.reference !== expected.reference ||
      image.digest !== expected.reference.split('@')[1] ||
      image.platform !== spec.runtime.platform
    )
      throw preconditionError(
        'Inference image identity differs from the pinned platform artifacts.',
      );
  }
  return {
    metadata,
    bundle,
    proofs,
    identity: sha256(await readFile(join(directory, 'managed.json'))),
    caddyfile: inferenceCaddyfile(bundle.spec, proofs),
    compose: inferenceRouterCompose(bundle.spec, topology, proofs),
  };
}
