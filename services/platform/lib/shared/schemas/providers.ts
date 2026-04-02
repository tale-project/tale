import { z } from 'zod/v4';

const modelTagLiterals = ['chat', 'vision', 'embedding'] as const;
export const modelTagSchema = z.enum(modelTagLiterals);
export type ModelTag = z.infer<typeof modelTagSchema>;

const modelDefinitionSchema = z.object({
  id: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(modelTagSchema).min(1),
  default: z.boolean().optional(),
  dimensions: z.number().int().positive().optional(),
});

export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

const translatableModelFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

const translatableProviderFieldsSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  models: z.record(z.string(), translatableModelFieldsSchema).optional(),
});

export const providerJsonSchema = z.object({
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  baseUrl: z.string().url(),
  supportsStructuredOutputs: z.boolean().optional(),
  models: z.array(modelDefinitionSchema).min(1),
  i18n: z
    .record(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
      translatableProviderFieldsSchema,
    )
    .optional(),
});

export type ProviderJson = z.infer<typeof providerJsonSchema>;

export const providerSecretsSchema = z.object({
  apiKey: z.string().min(1),
});

export type ProviderSecrets = z.infer<typeof providerSecretsSchema>;
