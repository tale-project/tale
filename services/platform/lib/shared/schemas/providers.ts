import { z } from 'zod/v4';

const modelTagLiterals = ['chat', 'vision', 'embedding'] as const;
const modelTagSchema = z.enum(modelTagLiterals);
type ModelTag = z.infer<typeof modelTagSchema>;

const modelDefinitionSchema = z.object({
  id: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(modelTagSchema).min(1),
  dimensions: z.number().int().positive().optional(),
});

type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

const providerDefaultsSchema = z.object({
  chat: z.string().min(1).max(200).optional(),
  vision: z.string().min(1).max(200).optional(),
  embedding: z.string().min(1).max(200).optional(),
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
});

export type ProviderSecrets = z.infer<typeof providerSecretsSchema>;
