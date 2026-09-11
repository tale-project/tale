import { isIP } from 'node:net';
import path from 'node:path';

import { z } from 'zod';

import { isPrivateIp } from '../../../../../services/platform/lib/shared/net/private-ip';
import { knowledgeEmbeddingSchema } from '../../../../../services/platform/lib/shared/schemas/knowledge';
import { providerDefinitionSchema } from '../../../../../services/platform/lib/shared/schemas/providers';
import { preconditionError, usageError } from '../../utils/fail';
import { valueHash } from '../config/releases/identity';
import { gitSha, relativePath, sha, slug } from '../config/releases/model';

const MAC_API_PORT = 18080;
export const ROUTER_API_PORT = 8081;
export const GIB = 1024 ** 3;

/** This adapter follows one reviewed upstream app layout. A new upstream
 * runtime requires another reviewed pin, rather than an unbounded pip update. */
export const OMLX_RUNTIME = {
  version: '0.6.4',
  sourceCommit: '1d7826185c5b5b69b38b27cbe57d7597b7551fd7',
  url: 'https://github.com/jundot/omlx/releases/download/v0.6.4/oMLX-0.6.4-macos15-sequoia.dmg',
  sha256: '5a90c7ae4a3f4ca8bf10dcc83d7f7395281e2ffb2a85d630c95e9720848e47cd',
  bytes: 782180533,
  minimumMacOS: 15,
  teamId: 'PSK5Q5T46L',
  bundleIdentifier: 'app.omlx',
  // Exact arm64 CodeDirectory observed in the pinned DMG. Its signed resource
  // seal covers the bundled Python/kernel bytes, including on installed reuse.
  arm64CodeDirectory:
    'f57a9fde5b412c8ff1fb358bc4bbf83da97ff1b9558c4126bf6319504e7a1da2',
} as const;

const bytes = z.number().int().nonnegative().safe();
const label = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const environmentName = z.string().regex(/^TALE_[A-Z0-9_]{1,120}(?![\s\S])/);
const keyReference = z.strictObject({ env: environmentName });
const privateAddress = z
  .string()
  .refine(
    (value) =>
      isIP(value) === 4 &&
      isPrivateIp(value) &&
      Number(value.split('.')[0]) < 224 &&
      !value.startsWith('169.254.') &&
      !value.startsWith('0.'),
    'expected a private IPv4 or loopback address, excluding link-local metadata',
  );
const modelFile = z.strictObject({
  path: relativePath.refine(
    (value) =>
      /^[A-Za-z0-9._/-]+$/.test(value) &&
      !value
        .split('/')
        .some((part) => part.startsWith('.') || part === '__pycache__') &&
      (/\.(?:json|safetensors|model|txt|jinja|jinja2|tiktoken|bpe|spm|md)$/i.test(
        value,
      ) ||
        /^(?:LICENSE|NOTICE|COPYING)(?:\.[A-Za-z0-9_-]+)?$/.test(value)),
    'model files must be portable data, never repository code or bytecode',
  ),
  sha256: sha,
  bytes: bytes.positive(),
});

export const inferenceModelSchema = z
  .strictObject({
    key: slug.refine(
      (key) =>
        providerDefinitionSchema.shape.name.safeParse(`omlx-${key}`).success,
      'model role must fit the native provider name',
    ),
    repository: z
      .string()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*(?![\s\S])/,
      ),
    revision: gitSha,
    // Wire model IDs also enter a fixed Caddy catalog response. Exclude its
    // placeholder grammar and quoting/control syntax before rendering.
    apiModel: label.regex(/^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,199}$/),
    capability: z.enum(['text', 'vision', 'embedding']),
    modelType: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_]+$/),
    files: z.array(modelFile).min(1).max(4096),
    requiredKernels: z
      .array(
        z.enum(['glm_moe_dsa', 'decode_fast', 'minimax_m3', 'qwen35_prefill']),
      )
      .max(4)
      .default([]),
    contextTokens: z.number().int().min(512).max(262144),
    embeddingDimensions: knowledgeEmbeddingSchema.shape.dimensions.optional(),
    configurationProjection: z
      .strictObject({
        kind: z.literal('signed-omlx-glm-dsa'),
        sourceSha256: sha,
        removeModelFile: z.literal('glm_moe_dsa.py'),
        runtimeSha256: sha,
      })
      .optional(),
  })
  .superRefine((model, context) => {
    const filenames = model.files.map((file) => file.path.toLowerCase());
    if (new Set(filenames).size !== filenames.length)
      context.addIssue({
        code: 'custom',
        message: 'Duplicate model file path',
      });
    if (
      !filenames.includes('config.json') ||
      !filenames.some((name) => name.endsWith('.safetensors'))
    )
      context.addIssue({
        code: 'custom',
        message: 'An MLX model needs config.json and safetensors weights',
      });
    if (
      !Number.isSafeInteger(
        model.files.reduce((sum, file) => sum + file.bytes, 0),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Model byte total is unsafe',
      });
    if (new Set(model.requiredKernels).size !== model.requiredKernels.length)
      context.addIssue({
        code: 'custom',
        message: 'Duplicate required kernel',
      });
    if (
      model.modelType === 'glm_moe_dsa' &&
      !model.requiredKernels.includes('glm_moe_dsa')
    )
      context.addIssue({
        code: 'custom',
        message: 'GLM DSA requires its native kernel admission check',
      });
    if (
      (model.capability === 'embedding') !==
      (model.embeddingDimensions !== undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Only embedding models declare an exact vector dimension',
      });
    if (
      model.configurationProjection &&
      (model.modelType !== 'glm_moe_dsa' ||
        model.capability !== 'text' ||
        model.files.find((file) => file.path === 'config.json')?.sha256 !==
          model.configurationProjection.sourceSha256)
    )
      context.addIssue({
        code: 'custom',
        message:
          'The bounded GLM projection must bind its exact original configuration.',
      });
  });

const inferenceNodeSchema = z.strictObject({
  key: slug,
  user: z.string().regex(/^[a-z][a-z0-9_-]{0,30}(?![\s\S])/),
  hostName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}(?![\s\S])/),
  address: privateAddress,
  port: z.number().int().min(1024).max(65535).default(MAC_API_PORT),
  models: z.array(slug).min(1).max(32),
  adminKey: keyReference,
});

const inferenceFields = z.strictObject({
  schemaVersion: z.literal(1),
  name: slug,
  organization: slug,
  runtime: z.literal('omlx-0.6.4-macos15'),
  mode: z.enum(['replicas', 'experimental-sharding']).default('replicas'),
  models: z.array(inferenceModelSchema).min(1).max(32),
  nodes: z.array(inferenceNodeSchema).min(1).max(64),
  serviceKey: keyReference,
  limits: z
    .strictObject({
      memoryReserveBytes: bytes.min(8 * GIB).default(32 * GIB),
      diskReserveBytes: bytes.min(8 * GIB).default(32 * GIB),
      ssdCacheBytes: bytes.max(1024 * GIB).default(16 * GIB),
      hotCacheBytes: bytes.max(256 * GIB).default(0),
      concurrency: z.literal(1).default(1),
      queuedRequests: z.number().int().min(0).max(256).default(4),
      queueTimeoutSeconds: z.number().int().min(1).max(3600).default(1800),
      requestTimeoutSeconds: z.number().int().min(60).max(3600).default(1800),
    })
    .prefault({}),
});

export const inferenceSpecSchema = inferenceFields.superRefine(
  (spec, context) => {
    for (const [name, values] of [
      ['model', spec.models.map((model) => model.key)],
      ['API model', spec.models.map((model) => model.apiModel)],
      ['node', spec.nodes.map((node) => node.key)],
      ['listener', spec.nodes.map((node) => `${node.address}:${node.port}`)],
    ] as const)
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: 'custom',
          message: `Duplicate ${name} identity`,
        });
    const models = new Set(spec.models.map((model) => model.key));
    for (const node of spec.nodes) {
      if (
        new Set(node.models).size !== node.models.length ||
        node.models.some((model) => !models.has(model))
      )
        context.addIssue({
          code: 'custom',
          message: 'Unknown or duplicate node model',
        });
      if (node.adminKey.env === spec.serviceKey.env)
        context.addIssue({
          code: 'custom',
          message: 'Service and admin keys must be separate',
        });
    }
    if (
      spec.models.some(
        (model) => !spec.nodes.some((node) => node.models.includes(model.key)),
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Every model needs a declared node',
      });
  },
);

export type InferenceSpec = z.infer<typeof inferenceSpecSchema>;
export type InferenceModel = z.infer<typeof inferenceModelSchema>;
export type InferenceNode = InferenceSpec['nodes'][number];
export type InferenceFetch = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function parseInferenceSpec(input: unknown): InferenceSpec {
  const parsed = inferenceSpecSchema.safeParse(input);
  if (!parsed.success)
    throw usageError(
      'Invalid inference specification. Check model pins, private nodes and resource limits.',
    );
  return parsed.data;
}

const inferenceInputSchema = inferenceFields.extend({
  nodes: z
    .array(
      inferenceNodeSchema.extend({
        address: z.union([privateAddress, keyReference]),
      }),
    )
    .min(1)
    .max(64),
});

/** Only public destination addresses resolve during preparation. Model pins
 * remain in the client source; secret references are never materialized here. */
export function resolveInferenceSpec(
  input: unknown,
  environment = process.env,
): InferenceSpec {
  const parsed = inferenceInputSchema.safeParse(input);
  if (!parsed.success)
    throw usageError('Invalid inference source specification.');
  return parseInferenceSpec({
    ...parsed.data,
    nodes: parsed.data.nodes.map((node) => {
      let address = node.address;
      if (typeof address !== 'string') {
        const value = environment[address.env];
        if (!value || !privateAddress.safeParse(value).success)
          throw preconditionError(
            'The declared inference address environment reference is missing or is not a private IPv4 address.',
          );
        address = value;
      }
      return Object.assign({}, node, { address });
    }),
  });
}

export function modelIdentity(model: InferenceModel): string {
  return valueHash({
    ...model,
    files: [...model.files].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
    requiredKernels: [...model.requiredKernels].sort(),
  });
}

/** The target is a macOS home, independent of the preparer's host path rules. */
export function inferenceStateDirectory(node: InferenceNode): string {
  return path.posix.join(
    '/Users',
    node.user,
    'Library/Application Support/Tale/inference',
    node.key,
  );
}

export function runtimeModelDirectory(
  state: string,
  model: InferenceModel,
): string {
  return path.posix.join(
    state,
    model.configurationProjection ? 'model-views' : 'models',
    modelIdentity(model),
  );
}
