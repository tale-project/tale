import { z } from 'zod';

import { visionModelConfigSchema } from '../../../../../services/platform/lib/shared/schemas/governance';
import { knowledgeEmbeddingSchema } from '../../../../../services/platform/lib/shared/schemas/knowledge';
import {
  modelCatalogFileSchema,
  providerDefinitionSchema,
  providerKeyEnvNameSchema,
} from '../../../../../services/platform/lib/shared/schemas/providers';

function cleanStrings(value: unknown): boolean {
  if (typeof value === 'string')
    return value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
  if (Array.isArray(value)) return value.every(cleanStrings);
  if (value && typeof value === 'object')
    return Object.values(value).every(cleanStrings);
  return true;
}

/** Public external-provider settings only. Server installation, routing,
 * hardware and model readiness belong to the endpoint's operator. */
const declarationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    exclusiveProviders: z.literal(true),
    providers: z
      .array(
        z.strictObject({
          definition: providerDefinitionSchema.refine((definition) => {
            if (!definition.baseUrl) return false;
            const url = new URL(definition.baseUrl);
            return (
              definition.apiFormat === 'openai' &&
              definition.catalog.source === 'models-endpoint' &&
              definition.endpointMode !== 'per-credential' &&
              !definition.harnessEndpoint &&
              definition.auth.length === 1 &&
              definition.auth[0]?.method === 'env' &&
              !url.username &&
              !url.password &&
              !url.search &&
              !url.hash &&
              url.href === definition.baseUrl &&
              !url.pathname.endsWith('/')
            );
          }, 'expected a fixed OpenAI models-endpoint provider with environment authentication'),
          credential: z.strictObject({
            name: z.string().min(1).max(80),
            envName: providerKeyEnvNameSchema,
          }),
          models: modelCatalogFileSchema.refine(
            (models) => models.length <= 200,
          ),
        }),
      )
      .min(1)
      .max(32),
    vision: visionModelConfigSchema.optional(),
    embedding: knowledgeEmbeddingSchema.optional(),
  })
  .superRefine((settings, context) => {
    const names = settings.providers.map((entry) => entry.definition.name);
    const fail = (message: string) =>
      context.addIssue({ code: 'custom', message });
    if (new Set(names).size !== names.length) fail('duplicate provider name');
    for (const entry of settings.providers)
      if (
        entry.models.some((model) => model.provider !== entry.definition.name)
      )
        fail('catalog models must belong to their declared provider');
    if (settings.vision) {
      const selected = settings.providers.find(
        (entry) => entry.definition.name === settings.vision?.providerSlug,
      );
      if (
        !selected?.models.some(
          (model) =>
            model.id === settings.vision?.modelId && model.supportsVision,
        )
      )
        fail('vision policy must select a declared vision-capable model');
    }
    if (settings.embedding) {
      const selected = settings.providers.find(
        (entry) => entry.definition.name === settings.embedding?.providerSlug,
      );
      if (
        !selected ||
        selected.definition.embedding !== 'supported' ||
        settings.embedding.baseUrl !== selected.definition.baseUrl ||
        !selected.models.some(
          (model) =>
            model.id === settings.embedding?.model &&
            model.tags.includes('embedding'),
        )
      )
        fail(
          'embedding must select the exact declared embedding model and endpoint',
        );
    }
  });

// Native URL schemas normalize URL whitespace. Reject it on the raw declaration
// before delegating to those schemas, so hidden delimiters never become valid.
export const modelSettingsSchema = z
  .custom<z.input<typeof declarationSchema>>(
    cleanStrings,
    'model settings contain whitespace or control characters',
  )
  .pipe(declarationSchema);

export type ModelSettings = z.infer<typeof modelSettingsSchema>;
