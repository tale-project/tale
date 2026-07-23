/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Faithful copy of the retired `lib/shared/schemas/providers.ts`.
 * `v0_2_98/01_claude_code_fable_default/migration.ts` types its catalog
 * literal against `ModelDefinition`, and
 * `legacy/frozen/providers_file_utils.ts`'s `parseProviderJson` validates a
 * real org `providers/<slug>.json` file against `providerJsonSchema` — both
 * need the FULL validation shape (not just the inferred type) to keep
 * migration behavior byte-identical, so this is frozen whole rather than
 * trimmed to a subset.
 *
 * One dependency substitution: the original imported `domainLiterals` from
 * `lib/shared/constants/domains.ts`, which ALSO retired (with the chat
 * logic + AI response pipeline). That list only gates the
 * optional per-model `routingTags` field, so it is inlined below verbatim
 * rather than pulling in a whole extra frozen module for one literal array.
 */

import { z } from 'zod/v4';

// -----------------------------------------------------------------------------
// retired lib/shared/constants/domains.ts (only
// `domainLiterals` is needed here, for `routingTagSchema` below).
// -----------------------------------------------------------------------------
const domainLiterals = [
  'code',
  'data',
  'math',
  'creative',
  'translation',
  'summary',
  'factual',
  'legal',
  'medical',
  'financial',
  'conversation',
  'general',
] as const;

export const modelTagLiterals = [
  'chat',
  'vision',
  'embedding',
  'image-generation',
  'image-edit',
  'transcription',
  'text-to-speech',
] as const;
const modelTagSchema = z.enum(modelTagLiterals);
export type ModelTag = z.infer<typeof modelTagSchema>;

const imageGenerationModeLiterals = ['images-api', 'chat-multimodal'] as const;
const imageGenerationModeSchema = z.enum(imageGenerationModeLiterals);

/**
 * How a `transcription` model's HTTP request body is shaped — the two
 * OpenAI-compatible audio-transcription conventions in the wild differ enough
 * that one field can't serve both. Omitted ⇒ `multipart`.
 */
const transcriptionModeLiterals = ['multipart', 'json-base64'] as const;
const transcriptionModeSchema = z.enum(transcriptionModeLiterals);

/**
 * Keys the AI SDK's openai-compatible chat provider treats specially and
 * silently strips from `providerOptions[<providerName>]` before spreading into
 * the request body. Rejected at parse time so users get a clear error.
 */
export const SDK_RESERVED_KEYS = [
  'user',
  'reasoningEffort',
  'textVerbosity',
  'strictJsonSchema',
] as const;

/**
 * Snake_case OpenAI-shaped body fields the SDK builds *before* the
 * providerOptions spread. Rejected at parse time so a config can't silently
 * overwrite the resolved model, blow past the token cap, or mute the prompt.
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
 * object's prototype rather than set an own property.
 */
export const PROTOTYPE_POLLUTION_KEYS = [
  '__proto__',
  'constructor',
  'prototype',
] as const;

const SDK_RESERVED_SET = new Set<string>(SDK_RESERVED_KEYS);
const BODY_OVERWRITE_SET = new Set<string>(BODY_OVERWRITE_KEYS);
const PROTOTYPE_POLLUTION_SET = new Set<string>(PROTOTYPE_POLLUTION_KEYS);

function addPrototypePollutionIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  key: string,
): void {
  ctx.addIssue({
    code: 'custom',
    message: `'${key}' is a reserved object-prototype key and is not allowed in providerOptions.`,
    path: [...path, key],
  });
}

function denyListRefine(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
  pathPrefix: readonly (string | number)[] = [],
): void {
  for (const [key, sub] of Object.entries(value)) {
    if (PROTOTYPE_POLLUTION_SET.has(key)) {
      addPrototypePollutionIssue(ctx, pathPrefix, key);
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
        message: `'${key}' is part of the request body Tale assembles and cannot be set via providerOptions. To cap output length, set the model's "Max output tokens" capability (Settings → Providers → edit model). To rename or drop a wire field for a quirky endpoint (e.g. max_tokens → max_completion_tokens), use the model's 'requestBodyMap'.`,
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
      deepCheckPrototypePollution(sub, ctx, [...pathPrefix, key]);
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
  for (const [key, sub] of Object.entries(value)) {
    if (PROTOTYPE_POLLUTION_SET.has(key)) {
      addPrototypePollutionIssue(ctx, pathPrefix, key);
    }
    if (sub !== null && typeof sub === 'object') {
      deepCheckPrototypePollution(sub, ctx, [...pathPrefix, key]);
    }
  }
}

/**
 * Free-form passthrough for provider-specific request body fields (e.g.
 * OpenRouter's `provider.quantizations`). Rejected keys: anything in
 * `SDK_RESERVED_KEYS` or `BODY_OVERWRITE_KEYS`.
 */
const providerOptionsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((value, ctx) => denyListRefine(value, ctx))
  .optional();

/**
 * Declarative transform applied to the FINAL serialized request body on the
 * way to the provider, provider-default ⊕ per-model.
 *
 *   - `rename`: `{ <fromKey>: <toKey> }` — applied first.
 *   - `remove`: `['<key>', …]` — applied after rename.
 */
const requestBodyMapSchema = z
  .object({
    rename: z.record(z.string(), z.string()).optional(),
    remove: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [from, to] of Object.entries(value.rename ?? {})) {
      if (PROTOTYPE_POLLUTION_SET.has(from)) {
        addPrototypePollutionIssue(ctx, ['rename'], from);
      }
      if (PROTOTYPE_POLLUTION_SET.has(to)) {
        ctx.addIssue({
          code: 'custom',
          message: `'${to}' is a reserved object-prototype key and is not allowed as a rename target.`,
          path: ['rename', from],
        });
      }
    }
    for (const key of value.remove ?? []) {
      if (PROTOTYPE_POLLUTION_SET.has(key)) {
        addPrototypePollutionIssue(ctx, ['remove'], key);
      }
    }
  })
  .optional();

/**
 * Single source of truth for TTS output audio formats.
 */
export const audioFormatLiterals = [
  'mp3',
  'opus',
  'aac',
  'flac',
  'wav',
  'pcm',
] as const;
export type AudioFormat = (typeof audioFormatLiterals)[number];

/**
 * Per-model reasoning-control capability for the Adaptive Reasoning Governor.
 *
 *  - `effort`       → request `reasoning_effort` ('minimal'|'low'|'medium'|'high')
 *  - `budgetTokens` → request `thinking: { budget_tokens }` (model self-truncates)
 *  - `none`         → opt this model out of the governor entirely
 */
export const reasoningCapabilitySchema = z.object({
  knob: z.enum(['effort', 'budgetTokens', 'none']),
  /** effort-only: the model supports the `'minimal'` floor (gpt-5 family). */
  supportsMinimal: z.boolean().optional(),
  /** budgetTokens-only: provider-mandated minimum (Anthropic requires ≥1024). */
  minBudgetTokens: z.number().int().positive().optional(),
  /** budgetTokens-only: a hard ceiling for the thinking budget. */
  maxBudgetTokens: z.number().int().positive().optional(),
});

export type ReasoningCapabilityConfig = z.infer<
  typeof reasoningCapabilitySchema
>;

/**
 * Per-model prompt-caching capability for the generic cache layer.
 *
 *  - `explicit-breakpoints` → inject `cache_control` markers (Anthropic / Gemini
 *    via OpenRouter); the gateway caches the prefix up to each breakpoint.
 *  - `auto-server`          → provider caches a stable prefix automatically
 *    (OpenAI / DeepSeek); we only set a `prompt_cache_key` routing hint.
 *  - `none`                 → emit nothing (unknown model; never risk a reject).
 */
export const promptCachingCapabilitySchema = z.object({
  mode: z.enum(['explicit-breakpoints', 'auto-server', 'none']),
  /** explicit-breakpoints-only: max cache_control markers (Anthropic caps at 4). */
  maxBreakpoints: z.number().int().positive().optional(),
});

export type PromptCachingCapabilityConfig = z.infer<
  typeof promptCachingCapabilitySchema
>;

/**
 * Coarse strength class used by complexity-based model routing and the
 * speculative cascade.
 *
 *  - `draft`    → cheapest / fastest; the cascade's first attempt.
 *  - `standard` → the everyday workhorse.
 *  - `frontier` → strongest / most expensive; the escalation target.
 */
export const modelTierLiterals = ['draft', 'standard', 'frontier'] as const;
export const modelTierSchema = z.enum(modelTierLiterals);
export type ModelTier = z.infer<typeof modelTierSchema>;

const routingTagSchema = z.enum(domainLiterals);

/**
 * Optional capability/routing metadata an operator can declare per model.
 * Every field is optional and additive.
 */
const modelRoutingMetadataFields = {
  /** Coarse strength class; see `modelTierSchema`. */
  tier: modelTierSchema.optional(),
  /** Fine-grained quality ordering within a tier (0–1); a tie-break for routing. */
  qualityScore: z.number().min(0).max(1).optional(),
  /** Domains this model is preferred for; biases `selectModelTier`. */
  routingTags: z.array(routingTagSchema).optional(),
  /** Total context window in tokens (input + output). */
  contextWindow: z.number().int().positive().optional(),
} as const;

/**
 * Reserved prefix every `secretsEnv` name must carry (issue #1711).
 */
export const SECRETS_ENV_PREFIX = 'TALE_PROVIDER_KEY_';

/** Save-time validation regex for `secretsEnv`: reserved prefix + ≥1 suffix
 * char (letters, digits, underscores). */
export const SECRETS_ENV_REGEX = /^TALE_PROVIDER_KEY_[A-Za-z0-9_]+$/;

/**
 * Optional name of an environment variable holding the API key (issue #1711).
 */
const secretsEnvSchema = z
  .string()
  .max(40)
  .regex(
    SECRETS_ENV_REGEX,
    'must start with TALE_PROVIDER_KEY_ and contain only letters, digits, and underscores',
  );

/**
 * The wire format (request/response schema) the provider's endpoint speaks —
 * NOT the transport or the vendor. `openai` = OpenAI Chat Completions shape
 * (the default); `anthropic` = Anthropic Messages shape.
 */
const apiFormatSchema = z.enum(['openai', 'anthropic']);

const modelDefinitionSchema = z.object({
  id: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  tags: z.array(modelTagSchema).min(1),
  /**
   * When true, the model is hidden from model-PICKER surfaces (chat composer,
   * agent model selection) but stays fully resolvable, so an agent/workflow
   * that already references it keeps working.
   */
  hidden: z.boolean().optional(),
  dimensions: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsStructuredOutputs: z.boolean().optional(),
  /** Reasoning-control capability override; see `reasoningCapabilitySchema`. */
  reasoning: reasoningCapabilitySchema.optional(),
  /** Prompt-caching capability override; see `promptCachingCapabilitySchema`. */
  promptCaching: promptCachingCapabilitySchema.optional(),
  // Optional routing/cascade metadata; see `modelRoutingMetadataFields`.
  ...modelRoutingMetadataFields,
  fallbackModelId: z.string().min(1).max(200).optional(),
  /**
   * The VENDOR-NATIVE id of this model — what the same model is called on the
   * vendor's own API, when this entry's `id` is gateway-shaped.
   */
  nativeModelId: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().optional(),
  /** Per-model override of the provider-level `secretsEnv`; see `secretsEnvSchema`. */
  secretsEnv: secretsEnvSchema.optional(),
  /** Per-model override of the provider-level `apiFormat`; see `apiFormatSchema`. */
  apiFormat: apiFormatSchema.optional(),
  imageGenerationMode: imageGenerationModeSchema.optional(),
  /** Transcription request convention; see `transcriptionModeSchema`. Only
   * meaningful on models tagged `'transcription'`. */
  transcriptionMode: transcriptionModeSchema.optional(),
  cost: z
    .object({
      inputCentsPerMillion: z.number().nonnegative().finite().optional(),
      outputCentsPerMillion: z.number().nonnegative().finite().optional(),
      /**
       * For image-generation models that charge per image rather than per
       * token.
       */
      imageCentsPerImage: z.number().nonnegative().finite().optional(),
      /**
       * For transcription models billed per minute of audio (e.g. OpenAI
       * whisper-1 at $0.006/min = 0.6).
       */
      centsPerAudioMinute: z.number().nonnegative().finite().optional(),
      /**
       * For text-to-speech models billed per character of input text
       * (e.g. OpenAI tts-1 at $15/M chars = 1500).
       */
      centsPerMillionCharacters: z.number().nonnegative().finite().optional(),
    })
    .optional(),
  /**
   * Default voice for TTS models when no locale-specific voice matches.
   * Whitespace-only strings are rejected.
   */
  defaultVoice: z
    .string()
    .min(1)
    .max(100)
    .regex(/\S/, 'defaultVoice cannot be all whitespace')
    .optional(),
  /**
   * Locale → voice mapping for TTS models. Keys follow a narrow BCP-47
   * subset: ISO-639-1 language with optional ISO-3166-1 alpha-2 region
   * (e.g. `en`, `en-US`, `de-CH`).
   */
  voicesByLocale: z
    .record(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
      z
        .string()
        .min(1)
        .max(100)
        .regex(/\S/, 'voice name cannot be all whitespace'),
    )
    .optional(),
  /**
   * Default natural-language tone/style prompt for TTS models that accept an
   * `instructions` field (OpenAI `gpt-4o-mini-tts`).
   */
  defaultInstructions: z.string().min(1).max(2000).optional(),
  /**
   * Locale → instructions mapping. Same lookup pattern as `voicesByLocale`.
   */
  instructionsByLocale: z
    .record(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
      z.string().min(1).max(2000),
    )
    .optional(),
  /**
   * Output audio format for TTS models. Defaults to mp3 when omitted.
   */
  audioFormat: z.enum(audioFormatLiterals).optional(),
  providerOptions: providerOptionsSchema,
  /**
   * Per-model request-body transform; see `requestBodyMapSchema`. Overrides
   * the provider-level `requestBodyMap` on conflicting sub-keys.
   */
  requestBodyMap: requestBodyMapSchema,
});

export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;

const providerDefaultsSchema = z.object({
  chat: z.string().min(1).max(200).optional(),
  vision: z.string().min(1).max(200).optional(),
  embedding: z.string().min(1).max(200).optional(),
  'image-generation': z.string().min(1).max(200).optional(),
  transcription: z.string().min(1).max(200).optional(),
  'text-to-speech': z.string().min(1).max(200).optional(),
  fallbackProviderName: z.string().min(1).max(200).optional(),
  fallbackModelId: z.string().min(1).max(200).optional(),
});

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
    /**
     * Optional env-var name holding this provider's API key (issue #1711).
     * Each model may override it with its own `secretsEnv`.
     */
    secretsEnv: secretsEnvSchema.optional(),
    /** Wire format this provider's endpoint speaks; see `apiFormatSchema`. */
    apiFormat: apiFormatSchema.optional(),
    supportsStructuredOutputs: z.boolean().optional(),
    defaults: providerDefaultsSchema.optional(),
    /**
     * Provider-level passthrough applied to every model in this file as a
     * default. Each model entry's own `providerOptions` overrides on
     * conflicting sub-keys.
     */
    providerOptions: providerOptionsSchema,
    /**
     * Provider-level request-body transform applied to every model in this
     * file as a default; each model's own `requestBodyMap` overrides on
     * conflicting sub-keys.
     */
    requestBodyMap: requestBodyMapSchema,
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
    if (data.defaults) {
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
        } else if (!model.tags.some((modelTag) => modelTag === tag)) {
          ctx.addIssue({
            code: 'custom',
            message: `defaults.${tag} references model "${modelId}" which lacks the "${tag}" tag`,
            path: ['defaults', tag],
          });
        }
      }
    }
    // Every model tagged `'text-to-speech'` must declare at least one voice
    // — `defaultVoice` OR a non-empty `voicesByLocale` — otherwise
    // `resolveTtsModel` throws `UNKNOWN_VOICE` at first synthesis and the
    // config bug surfaces only after a user action.
    data.models.forEach((model, modelIndex) => {
      if (!model.tags.includes('text-to-speech')) {
        return;
      }
      const hasDefault =
        typeof model.defaultVoice === 'string' && model.defaultVoice.length > 0;
      const hasMap =
        model.voicesByLocale !== undefined &&
        Object.keys(model.voicesByLocale).length > 0;
      if (hasDefault || hasMap) return;
      const offendingField =
        model.voicesByLocale !== undefined ? 'voicesByLocale' : 'defaultVoice';
      ctx.addIssue({
        code: 'custom',
        message: `model "${model.id}" has the "text-to-speech" tag but no defaultVoice or voicesByLocale entries; resolveTtsModel will fail at synthesis time`,
        path: ['models', modelIndex, offendingField],
      });
    });
  });

export type ProviderJson = z.infer<typeof providerJsonSchema>;

export const providerSecretsSchema = z.object({
  apiKey: z.string().min(1),
  modelKeys: z.record(z.string(), z.string().min(1)).optional(),
});

export type ProviderSecrets = z.infer<typeof providerSecretsSchema>;
