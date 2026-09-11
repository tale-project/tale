import { mkdir, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { valueHash } from '../config/releases/identity';
import { sha } from '../config/releases/model';
import { withDeploymentSources } from '../deployment/sources';
import {
  INFERENCE_ADMISSION_FILENAME,
  INFERENCE_ADMISSION_SHA,
  INFERENCE_ADMISSION_SOURCE,
} from './admission';
import { boundedJson, fileDigest, writePublicArtifact } from './files';
import {
  inferenceSpecSchema,
  OMLX_RUNTIME,
  parseInferenceSpec,
  resolveInferenceSpec,
} from './model';
import {
  committedInferenceSource,
  inferenceSourceSchema,
  verifyInferenceSource,
  type InferenceSource,
} from './source';

const bundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-inference'),
  spec: inferenceSpecSchema,
  runtime: z.unknown(),
  admission: z.strictObject({
    path: z.literal(INFERENCE_ADMISSION_FILENAME),
    sha256: sha,
    bytes: z.number().int().positive(),
  }),
  source: inferenceSourceSchema.optional(),
  bundleSha256: sha,
});
export type InferenceBundle = z.infer<typeof bundleSchema>;
export function inferenceBundleHash(
  spec: unknown,
  source?: InferenceSource,
): string {
  return valueHash(unsigned(spec, source));
}
function unsigned(spec: unknown, source?: InferenceSource) {
  const parsed = parseInferenceSpec(spec);
  if (source)
    verifyInferenceSource(inferenceSourceSchema.parse(source), parsed);
  return {
    schemaVersion: 1 as const,
    kind: 'tale-inference' as const,
    spec: parsed,
    runtime: OMLX_RUNTIME,
    admission: {
      path: INFERENCE_ADMISSION_FILENAME,
      sha256: INFERENCE_ADMISSION_SHA,
      bytes: Buffer.byteLength(INFERENCE_ADMISSION_SOURCE),
    } as const,
    ...(source ? { source } : {}),
  };
}

export async function prepareInferenceFromSource(
  options: {
    repository: string;
    sourceRef: string;
    spec: string;
    output: string;
    sources?: string;
  },
  acquire: typeof withDeploymentSources = withDeploymentSources,
) {
  const request = {
    repository: options.repository,
    revision: options.sourceRef,
  };
  return acquire(
    [request],
    {
      sourcesFile: options.sources,
      sourceKey: process.env.TALE_SOURCE_SSH_KEY,
    },
    async (checkout) => {
      const source = committedInferenceSource(
        checkout(request),
        options.repository,
        options.sourceRef,
        options.spec,
      );
      let input: unknown;
      try {
        input = JSON.parse(source.content);
      } catch {
        throw preconditionError(
          'Committed inference source is not valid JSON.',
        );
      }
      return prepareInferenceValue(input, options.output, process.env, source);
    },
  );
}

/** Preparation only records exact bytes to acquire. It never downloads weights
 * or probes the preparer's GPU as a substitute for destination hardware. */
export async function prepareInference(
  specFile: string,
  output: string,
): Promise<InferenceBundle> {
  return prepareInferenceValue(await boundedJson(specFile), output);
}

export async function prepareInferenceValue(
  input: unknown,
  output: string,
  environment = process.env,
  source?: InferenceSource,
): Promise<InferenceBundle> {
  const body = unsigned(resolveInferenceSpec(input, environment), source);
  const directory = resolve(output);
  try {
    await mkdir(directory, { mode: 0o755 });
  } catch {
    throw preconditionError(
      'Inference output already exists or cannot be created. Choose a new directory.',
    );
  }
  const bundle = { ...body, bundleSha256: valueHash(body) };
  await writePublicArtifact(
    join(directory, 'inference.json'),
    JSON.stringify(bundle, null, 2) + '\n',
  );
  await writePublicArtifact(
    join(directory, INFERENCE_ADMISSION_FILENAME),
    INFERENCE_ADMISSION_SOURCE,
  );
  return bundle;
}

export async function verifyInferenceBundle(
  directory: string,
  expectedHash?: string,
): Promise<InferenceBundle> {
  if (expectedHash !== undefined && !sha.safeParse(expectedHash).success)
    throw preconditionError(
      'Expected inference bundle SHA must be a full SHA-256.',
    );
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    JSON.stringify((await readdir(directory)).sort()) !==
      JSON.stringify(['inference.json', INFERENCE_ADMISSION_FILENAME].sort())
  )
    throw preconditionError(
      'Inference bundle must contain only its bounded manifest and exact admission adapter.',
    );
  const result = bundleSchema.safeParse(
    await boundedJson(join(directory, 'inference.json')),
  );
  if (!result.success)
    throw preconditionError('Inference bundle does not match its schema.');
  const bundle = result.data;
  const canonical = unsigned(bundle.spec, bundle.source);
  if (
    valueHash(bundle.runtime) !== valueHash(OMLX_RUNTIME) ||
    valueHash(bundle.admission) !== valueHash(canonical.admission) ||
    (await fileDigest(
      join(directory, INFERENCE_ADMISSION_FILENAME),
      canonical.admission.bytes,
    )) !== INFERENCE_ADMISSION_SHA ||
    valueHash(canonical) !== bundle.bundleSha256 ||
    (expectedHash !== undefined && expectedHash !== bundle.bundleSha256)
  )
    throw preconditionError(
      'Inference bundle or runtime pin differs from the selected bytes.',
    );
  return bundle;
}
