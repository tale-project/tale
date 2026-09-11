import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { sha256, stableJson } from '../config/releases/identity';
import type { InferenceModel } from './model';

const quantization = z
  .object({
    bits: z.union([z.literal(4), z.literal(8)]),
    group_size: z.union([z.literal(32), z.literal(64), z.literal(128)]),
    mode: z.literal('affine').optional(),
  })
  .strict();
const glmConfiguration = z
  .object({
    model_type: z.literal('glm_moe_dsa'),
    model_file: z.literal('glm_moe_dsa.py'),
    num_hidden_layers: z.number().int().min(1).max(256),
    first_k_dense_replace: z.number().int().min(0),
    moe_layer_freq: z.literal(1),
    indexer_types: z
      .array(z.enum(['full', 'shared']))
      .min(1)
      .max(256),
    indexer_rope_interleave: z.literal(true),
    rope_interleave: z.literal(true),
    mlp_layer_types: z
      .array(z.enum(['dense', 'sparse']))
      .min(1)
      .max(256),
    index_topk_freq: z.number().int().min(1),
    index_skip_topk_offset: z.number().int().min(0),
    index_topk_pattern: z.null(),
    quantization,
  })
  .passthrough();

/** One explicit selector removal, never arbitrary overrides. The original
 * config remains retained and hash-verified. oMLX's signed GLM patch already
 * supports this dense/shared-indexer layout; the destination must still prove
 * strict weight load and a complete synthetic output before becoming ready. */
export function projectModelConfiguration(
  model: Pick<InferenceModel, 'configurationProjection'>,
  original: Uint8Array,
): Buffer {
  const projection = model.configurationProjection;
  if (!projection || sha256(original) !== projection.sourceSha256)
    throw preconditionError(
      'Model configuration projection does not match its original hash.',
    );
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(original).toString('utf8'));
  } catch {
    throw preconditionError('Model configuration is not valid JSON.');
  }
  const result = glmConfiguration.safeParse(raw);
  if (!result.success)
    throw preconditionError(
      'The GLM configuration is outside the supported signed runtime projection.',
    );
  const config = result.data;
  if (
    config.indexer_types.length !== config.num_hidden_layers ||
    config.mlp_layer_types.length !== config.num_hidden_layers ||
    config.first_k_dense_replace > config.num_hidden_layers ||
    config.indexer_types[0] !== 'full' ||
    config.mlp_layer_types.some(
      (kind, index) =>
        kind !== (index < config.first_k_dense_replace ? 'dense' : 'sparse'),
    )
  )
    throw preconditionError(
      'GLM indexer or feed-forward layout differs from its declared layer contract.',
    );
  // Work from the validated raw mapping. Passthrough preserves every unrelated
  // field, including quantization, tokenizer, rotary and context configuration.
  const { model_file: _modelFile, ...runtime } = config;
  const bytes = Buffer.from(stableJson(runtime) + '\n');
  if (sha256(bytes) !== projection.runtimeSha256)
    throw preconditionError(
      'Derived model configuration differs from its declared runtime hash.',
    );
  return bytes;
}
