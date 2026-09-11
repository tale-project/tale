import { z } from 'zod';

import { visionModelConfigSchema } from '../../../../../services/platform/lib/shared/schemas/governance';
import { knowledgeEmbeddingSchema } from '../../../../../services/platform/lib/shared/schemas/knowledge';
import { providerDefinitionSchema } from '../../../../../services/platform/lib/shared/schemas/providers';
import { externalDepError } from '../../utils/fail';
import { valueHash } from '../config/releases/identity';
import { sha, slug } from '../config/releases/model';
import { ROUTER_API_PORT, type InferenceSpec } from '../inference/model';

/** Shared desired native state for provisioning and independent host readback.
 * File hashes report the bytes actually verified by the native config reader;
 * existing semantically identical YAML need not have our serializer's layout. */
export function desiredNativeInference(spec: InferenceSpec) {
  const providers = spec.models.map((model) => ({
    model,
    definition: providerDefinitionSchema.parse({
      name: `omlx-${model.key}`,
      displayName: `oMLX ${model.key}`,
      apiFormat: 'openai',
      baseUrl: `http://inference-overlay.local:${ROUTER_API_PORT}/${spec.organization}/${model.key}/v1`,
      catalog: { source: 'models-endpoint' },
      embedding: model.capability === 'embedding' ? 'supported' : 'unknown',
      auth: [{ method: 'env' }],
    }),
  }));
  const vision = providers.find((entry) => entry.model.capability === 'vision');
  const embedding = providers.find(
    (entry) => entry.model.capability === 'embedding',
  );
  return {
    providers,
    vision:
      vision &&
      visionModelConfigSchema.parse({
        providerSlug: vision.definition.name,
        modelId: vision.model.apiModel,
      }),
    embedding:
      embedding &&
      knowledgeEmbeddingSchema.parse({
        providerSlug: embedding.definition.name,
        model: embedding.model.apiModel,
        dimensions: embedding.model.embeddingDimensions,
        baseUrl: embedding.definition.baseUrl,
      }),
  };
}

const nativeInferenceProofSchema = z.object({
  configured: z.literal(true),
  organizationId: z.string().min(1).max(256),
  organizationSlug: slug,
  companionSha256: sha,
  providers: z
    .array(
      z.object({
        name: providerDefinitionSchema.shape.name,
        model: z.string().min(1).max(200),
        capability: z.enum(['text', 'vision', 'embedding']),
        providerFileSha256: sha,
      }),
    )
    .min(1)
    .max(3),
  vision: visionModelConfigSchema.nullable(),
  embedding: knowledgeEmbeddingSchema.nullable(),
  unchanged: z.boolean(),
  runtimeReadiness: z.literal('reported-separately-by-the-inference-node'),
});

export function verifyNativeInferenceProof(
  input: unknown,
  spec: InferenceSpec,
  companionSha256: string,
  organizationId: string,
) {
  const parsed = nativeInferenceProofSchema.safeParse(input);
  const desired = desiredNativeInference(spec);
  if (
    !parsed.success ||
    parsed.data.organizationId !== organizationId ||
    parsed.data.organizationSlug !== spec.organization ||
    parsed.data.companionSha256 !== companionSha256 ||
    valueHash(parsed.data.vision) !== valueHash(desired.vision ?? null) ||
    valueHash(parsed.data.embedding) !== valueHash(desired.embedding ?? null) ||
    valueHash(
      parsed.data.providers.map(({ name, model, capability }) => ({
        name,
        model,
        capability,
      })),
    ) !==
      valueHash(
        desired.providers.map(({ definition, model }) => ({
          name: definition.name,
          model: model.apiModel,
          capability: model.capability,
        })),
      )
  )
    throw externalDepError(
      'Native inference receipt differs from the reviewed organization, model routes or policies.',
    );
  return parsed.data;
}
