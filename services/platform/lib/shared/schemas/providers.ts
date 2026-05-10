import { z } from 'zod/v4';

export const modelTagLiterals = [
  'chat',
  'vision',
  'embedding',
  'image-generation',
  'image-edit',
  'transcription',
] as const;
const modelTagSchema = z.enum(modelTagLiterals);
export type ModelTag = z.infer<typeof modelTagSchema>;

const imageGenerationModeLiterals = ['images-api', 'chat-multimodal'] as const;
const imageGenerationModeSchema = z.enum(imageGenerationModeLiterals);

/**
 * Keys the AI SDK's openai-compatible chat provider treats specially and
 * silently strips from `providerOptions[<providerName>]` before spreading into
 * the request body. Source:
 * `@ai-sdk/openai-compatible/dist/index.mjs` lines 323-345 + 528-537.
 *
 * Rejected at parse time so users get a clear error (set this at the agent
 * level / streamText param) rather than a silent drop.
 */
export const SDK_RESERVED_KEYS = [
  'user',
  'reasoningEffort',
  'textVerbosity',
  'strictJsonSchema',
] as const;

/**
 * Snake_case OpenAI-shaped body fields the SDK builds *before* the
 * providerOptions spread. Without rejecting these at parse time, a config
 * could silently overwrite the resolved model, blow past the token cap, or
 * mute the prompt — see plan "Body-overwrite blocker" for details.
 *
 * Also includes caller-only knobs that are not SDK-assembled but, if set via
 * provider config, would silently amplify cost (`n`), corrupt usage telemetry
 * (`stream_options`), inflate response size (`logprobs`/`top_logprobs`), or
 * leak PII to the upstream (`metadata`/`store`/`logit_bias`).
 *
 * `prompt` and `size` cover the image-gen body shape: the SDK image path
 * writes them BEFORE the providerOptions spread (`@ai-sdk/openai-compatible`
 * `index.mjs:1667-1672`), so an unguarded passthrough could swap the user's
 * prompt. `max_completion_tokens` is the OpenAI reasoning-model token cap
 * that bypasses `max_tokens`. `reasoning_effort` / `verbosity` are the
 * snake_case forms of the SDK's camelCase reserved keys; the SDK overwrites
 * them with `undefined`, silently dropping a misnamed user value.
 */
export const BODY_OVERWRITE_KEYS = [
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'temperature',
  'max_tokens',
  'max_completion_tokens',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'response_format',
  'stop',
  'seed',
  'n',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'stream_options',
  'store',
  'metadata',
  'prompt',
  'size',
  'reasoning_effort',
  'verbosity',
] as const;

/**
 * Object-prototype keys. JSON.parse + bracket assignment can replace an
 * object's prototype rather than set an own property. Defense-in-depth —
 * V01 confirmed no global pollution path reaches the wire today, but the
 * cost is six lines so we close the surface.
 */
export const PROTOTYPE_POLLUTION_KEYS = [
  '__proto__',
  'constructor',
  'prototype',
] as const;

const SDK_RESERVED_SET = new Set<string>(SDK_RESERVED_KEYS);
const BODY_OVERWRITE_SET = new Set<string>(BODY_OVERWRITE_KEYS);
const PROTOTYPE_POLLUTION_SET = new Set<string>(PROTOTYPE_POLLUTION_KEYS);

function denyListRefine(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
  pathPrefix: readonly (string | number)[] = [],
): void {
  for (const [key, sub] of Object.entries(value)) {
    if (PROTOTYPE_POLLUTION_SET.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `'${key}' is a reserved object-prototype key and is not allowed in providerOptions.`,
        path: [...pathPrefix, key],
      });
      continue;
    }
    if (SDK_RESERVED_SET.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `'${key}' is filtered by the AI SDK; set it at the agent level (streamText param) instead of in providerOptions.`,
        path: [...pathPrefix, key],
      });
    } else if (BODY_OVERWRITE_SET.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `'${key}' would overwrite the request body's '${key}' field. Configure it via the agent's model/temperature/maxOutputTokens fields, not providerOptions.`,
        path: [...pathPrefix, key],
      });
    } else if (pathPrefix.length === 0 && Array.isArray(sub)) {
      // Top-level value of an array spreads as numeric keys into the body —
      // `{provider: ['fp8']}` would surface as `body.provider = ['fp8']`,
      // which is almost never what the user means. Reject so the user gets a
      // clear error pointing at the bad key.
      ctx.addIssue({
        code: 'custom',
        message: `'${key}' value must be an object or primitive, not an array. Wrap fields in an object (e.g. { provider: { quantizations: ['fp8'] } }).`,
        path: [...pathPrefix, key],
      });
    } else if (
      pathPrefix.length === 0 &&
      sub !== null &&
      typeof sub === 'object' &&
      !Array.isArray(sub)
    ) {
      // Recurse one level so a double-wrap like
      // `providerOptions.openrouter.model` is also caught as an authoring
      // mistake.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typeof check + non-array narrowing
      denyListRefine(sub as Record<string, unknown>, ctx, [...pathPrefix, key]);
    }
    // Prototype-pollution keys are illegal at any depth, even inside
    // legitimately deep provider-specific objects.
    if (sub !== null && typeof sub === 'object') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typeof check
      deepCheckPrototypePollution(sub as object, ctx, [...pathPrefix, key]);
    }
  }
}

function deepCheckPrototypePollution(
  value: object,
  ctx: z.RefinementCtx,
  pathPrefix: readonly (string | number)[],
): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item !== null && typeof item === 'object') {
        deepCheckPrototypePollution(item, ctx, [...pathPrefix, i]);
      }
    }
    return;
  }
  for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
    if (PROTOTYPE_POLLUTION_SET.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `'${key}' is a reserved object-prototype key and is not allowed in providerOptions.`,
        path: [...pathPrefix, key],
      });
    }
    if (sub !== null && typeof sub === 'object') {
      deepCheckPrototypePollution(sub, ctx, [...pathPrefix, key]);
    }
  }
}

/**
 * Free-form passthrough for provider-specific request body fields (e.g.
 * OpenRouter's `provider.quantizations`). The resolver namespaces these under
 * the actual provider name at call time, so author the **inner** body shape:
 *
 *   ```json
 *   { "provider": { "quantizations": ["fp8"] } }
 *   ```
 *
 * — never wrap in `{ "openrouter": { ... } }`. See `docs/en/self-hosted/configuration/providers.md`.
 *
 * Rejected keys: anything in `SDK_RESERVED_KEYS` (silently stripped by SDK)
 * or `BODY_OVERWRITE_KEYS` (would clobber legit body fields). Both are
 * checked at the top level and one level deep. Top-level array values are
 * also rejected (they would spread as numeric-key fields).
 */
const providerOptionsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => denyListRefine(value, ctx))
  .optional();

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
      /**
       * For transcription models billed per minute of audio (e.g. OpenAI
       * whisper-1 at $0.006/min = 0.6). Used by
       * `estimateTranscriptionCostCents` to compute ledger entries.
       */
      centsPerAudioMinute: z.number().optional(),
    })
    .optional(),
  providerOptions: providerOptionsSchema,
});

type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

const providerDefaultsSchema = z.object({
  chat: z.string().min(1).max(200).optional(),
  vision: z.string().min(1).max(200).optional(),
  embedding: z.string().min(1).max(200).optional(),
  'image-generation': z.string().min(1).max(200).optional(),
  transcription: z.string().min(1).max(200).optional(),
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
    /**
     * Provider-level passthrough applied to every model in this file as a
     * default. Each model entry's own `providerOptions` overrides on
     * conflicting sub-keys. See `providerOptionsSchema` JSDoc above for the
     * deny-list and authoring conventions.
     */
    providerOptions: providerOptionsSchema,
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
