import { z } from 'zod/v4';

const modelTagLiterals = [
  'chat',
  'vision',
  'embedding',
  'image-generation',
  'image-edit',
] as const;
const modelTagSchema = z.enum(modelTagLiterals);
export type ModelTag = z.infer<typeof modelTagSchema>;

const imageGenerationModeLiterals = ['images-api', 'chat-multimodal'] as const;
const imageGenerationModeSchema = z.enum(imageGenerationModeLiterals);

const modelDefinitionSchema = z.object({
  id: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(modelTagSchema).min(1),
  dimensions: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
  fallbackModelId: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().optional(),
  imageGenerationMode: imageGenerationModeSchema.optional(),
  cost: z
    .object({
      inputCentsPerMillion: z.number().optional(),
      outputCentsPerMillion: z.number().optional(),
      /**
       * For image-generation models that charge per image rather than per
       * token. When set, cost tracking for this model uses
       * `imageCount * imageCentsPerImage` directly, bypassing token math.
       */
      imageCentsPerImage: z.number().optional(),
    })
    .optional(),
});

type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

const providerDefaultsSchema = z.object({
  chat: z.string().min(1).max(200).optional(),
  vision: z.string().min(1).max(200).optional(),
  embedding: z.string().min(1).max(200).optional(),
  'image-generation': z.string().min(1).max(200).optional(),
  fallbackProviderName: z.string().min(1).max(200).optional(),
  fallbackModelId: z.string().min(1).max(200).optional(),
});

type ProviderDefaults = z.infer<typeof providerDefaultsSchema>;

const translatableModelFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

const translatableProviderFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  models: z.record(z.string(), translatableModelFieldsSchema).optional(),
});

export const providerJsonSchema = z
  .object({
    displayName: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    baseUrl: z.string().url(),
    supportsStructuredOutputs: z.boolean().optional(),
    defaults: providerDefaultsSchema.optional(),
    models: z
      .array(modelDefinitionSchema)
      .min(1)
      .refine(
        (models) => new Set(models.map((m) => m.id)).size === models.length,
        { message: 'Model IDs must be unique' },
      ),
    i18n: z
      .record(
        z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
        translatableProviderFieldsSchema,
      )
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.defaults) return;
    const modelMap = new Map(data.models.map((m) => [m.id, m]));
    for (const [tag, modelId] of Object.entries(data.defaults)) {
      if (modelId === undefined) continue;
      const model = modelMap.get(modelId);
      if (!model) {
        ctx.addIssue({
          code: 'custom',
          message: `defaults.${tag} references unknown model "${modelId}"`,
          path: ['defaults', tag],
        });
      } else if (!(model.tags as readonly string[]).includes(tag)) {
        ctx.addIssue({
          code: 'custom',
          message: `defaults.${tag} references model "${modelId}" which lacks the "${tag}" tag`,
          path: ['defaults', tag],
        });
      }
    }
  });

export type ProviderJson = z.infer<typeof providerJsonSchema>;

export const providerSecretsSchema = z.object({
  apiKey: z.string().min(1),
  modelKeys: z.record(z.string(), z.string().min(1)).optional(),
});

export type ProviderSecrets = z.infer<typeof providerSecretsSchema>;
