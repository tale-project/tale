import { z } from 'zod/v4';

import { domainLiterals } from '../constants/domains';

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
 * that one field can't serve both:
 *
 *  - `multipart` → `multipart/form-data` with a binary `file` field and
 *    `response_format: verbose_json` (OpenAI Whisper, vLLM, LocalAI,
 *    faster-whisper-server). Returns `{ text, duration, segments }`, so
 *    paragraph breaks and `[HH:MM:SS]` timestamps survive.
 *  - `json-base64` → a JSON body with `input_audio: { data: <base64>, format }`
 *    (OpenRouter). Returns `{ text, usage }` only — no segments/duration, so
 *    timestamped transcripts gracefully degrade to plain text and billing
 *    falls back to the locally-measured audio duration.
 *
 * Omitted ⇒ `multipart`, the long-standing default that keeps every existing
 * self-hosted OpenAI-compatible whisper server working unchanged.
 */
const transcriptionModeLiterals = ['multipart', 'json-base64'] as const;
const transcriptionModeSchema = z.enum(transcriptionModeLiterals);

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
      addPrototypePollutionIssue(ctx, pathPrefix, key);
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

/**
 * Declarative transform applied to the FINAL serialized request body on the way
 * to the provider (see `convex/providers/request_body_transform.ts`),
 * provider-default ⊕ per-model. Unlike `providerOptions` — which is spread onto
 * the wire and is therefore deny-listed against clobbering reserved fields —
 * this is meta-config that never reaches the provider: it renames/removes body
 * fields AFTER the SDK assembles them. It is thus the sanctioned way to rewrite
 * a reserved field for a quirky endpoint, e.g.
 * `{ rename: { max_tokens: 'max_completion_tokens' } }` for an OpenAI / Azure
 * reasoning deployment. `remove` deletes fields the endpoint rejects. Only
 * object-prototype keys are forbidden (same defense-in-depth as providerOptions).
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
 * Single source of truth for TTS output audio formats. Exported so the
 * Convex `ttsAudioChunks` validator, the action's MIME map, and the
 * `resolveTtsModel` resolver all stay in sync via one literal list.
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
 * Per-model reasoning-control capability for the Adaptive Reasoning Governor
 * (`convex/lib/agent_response/reasoning/`). Declares whether the model can be
 * told how hard to think and which control surface it exposes. Operators only
 * need this for reasoning models outside the governor's built-in curated table,
 * or to pin/disable reasoning for a specific deployment — common families
 * (gpt-5*, o-series, Claude 3.7/4 thinking) work without it.
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
 * Per-model prompt-caching capability for the generic cache layer
 * (`convex/lib/agent_response/prompt_caching/`). Declares how a model caches a
 * stable prompt prefix so repeat turns are cheaper and lower-latency. Operators
 * only need this for models outside the built-in curated table, or to pin a
 * mode for a specific deployment/gateway.
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
 * speculative cascade (`convex/lib/agent_response/model_routing/`).
 *
 *  - `draft`    → cheapest / fastest; the cascade's first attempt.
 *  - `standard` → the everyday workhorse.
 *  - `frontier` → strongest / most expensive; the escalation target and the
 *                 forced choice for high-stakes domains (see `HIGH_STAKES_DOMAINS`).
 *
 * Operator-authored. When omitted, routing infers a tier from the model's
 * relative `cost.outputCentsPerMillion` within the agent's `supportedModels`.
 */
export const modelTierLiterals = ['draft', 'standard', 'frontier'] as const;
export const modelTierSchema = z.enum(modelTierLiterals);
export type ModelTier = z.infer<typeof modelTierSchema>;

const routingTagSchema = z.enum(domainLiterals);

/**
 * Optional capability/routing metadata an operator can declare per model.
 * Every field is optional and additive; `model_metadata.ts` reads them when
 * building routing candidates. Existing provider JSONs without these fields
 * keep working — routing infers a `tier` from relative cost, treats an absent
 * `qualityScore` as 0, and an absent `routingTags` as no domain preference.
 *
 * Deliberately NOT included here (redundant with signals the config already
 * carries): `supportsVision` (use the `'vision'` tag), `supportsTools`
 * (assumed for every chat model — nothing gates on it), and `speedMs` (never
 * read by any routing decision).
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
 * Reserved prefix every `secretsEnv` name must carry (issue #1711). The
 * env-var key source is gated by this prefix rather than an operator allowlist:
 * a Convex Node action can read ALL deployment secrets via `process.env`
 * (`SOPS_AGE_KEY`, `BETTER_AUTH_SECRET`, …), so restricting `secretsEnv` to a
 * dedicated namespace stops a config-write actor from naming a deployment
 * secret and exfiltrating it via a provider `baseUrl`. Fail-closed: any name
 * outside the prefix is rejected. Changing this is a one-line edit — the schema
 * regex, the TS resolver (`convex/providers/secret_resolver.ts`), and the
 * Python loader (`tale_shared/config/providers.py`) all derive from it. The
 * 18-char prefix leaves 22 chars for the suffix under the 40-char cap.
 */
export const SECRETS_ENV_PREFIX = 'TALE_PROVIDER_KEY_';

/** Save-time validation regex for `secretsEnv`: reserved prefix + ≥1 suffix
 * char (letters, digits, underscores). Mirrored client-side in the provider
 * settings UI. */
export const SECRETS_ENV_REGEX = /^TALE_PROVIDER_KEY_[A-Za-z0-9_]+$/;

/**
 * Optional name of an environment variable holding the API key (issue #1711).
 * Lives in the PUBLIC provider config (a var name is not a secret). The
 * resolution path prefers this over the file `apiKey`. The name must start with
 * `SECRETS_ENV_PREFIX` (see above). The 40-char cap matches the platform→Convex
 * env-name sync limit in `docker-entrypoint.sh` — a longer name would silently
 * never reach the Node action chat path.
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
 * (the default; what `createOpenAICompatible` and most providers use);
 * `anthropic` = Anthropic Messages shape (e.g. DeepSeek's `/anthropic`
 * endpoint, which natively serves Claude Code server tools like web search).
 * Settable per provider and per model (model overrides provider); absent ⇒
 * `openai`. Drives the external-agent gateway's `base_provider_type`; the chat
 * path is OpenAI-compatible-only for now (anthropic providers used in chat fall
 * back to the OpenAI client and error at the wire level).
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
   * that already references it keeps working. The model-sync bot sets this on
   * superseded older model versions; operators can toggle it per model. Absent
   * ⇒ visible.
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
   * vendor's own API, when this entry's `id` is gateway-shaped (e.g. the
   * OpenRouter `anthropic/claude-fable-5` is natively `claude-fable-5`). A BYO
   * (direct-to-vendor) session requests this id instead of the gateway one; an
   * entry without it passes through unchanged. The weekly model sync derives it
   * for auto-added Anthropic models.
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
       * token. When set, cost tracking for this model uses
       * `imageCount * imageCentsPerImage` directly, bypassing token math.
       */
      imageCentsPerImage: z.number().nonnegative().finite().optional(),
      /**
       * For transcription models billed per minute of audio (e.g. OpenAI
       * whisper-1 at $0.006/min = 0.6). Used by
       * `estimateTranscriptionCostCents` to compute ledger entries.
       */
      centsPerAudioMinute: z.number().nonnegative().finite().optional(),
      /**
       * For text-to-speech models billed per character of input text
       * (e.g. OpenAI tts-1 at $15/M chars = 1500). When the upstream
       * meter is per-token (e.g. gpt-4o-mini-tts), operators supply a
       * char-approximation here; the value is used directly by
       * `estimateTtsCostCents` without conversion.
       */
      centsPerMillionCharacters: z.number().nonnegative().finite().optional(),
    })
    .optional(),
  /**
   * Default voice for TTS models when no locale-specific voice matches.
   * Whitespace-only strings are rejected so `'   '` doesn't silently slip
   * through .min(1) and surface later as UNKNOWN_VOICE at synth time.
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
   * (e.g. `en`, `en-US`, `de-CH`). Broader BCP-47 — script subtags
   * (`zh-Hans`), 3-letter codes (`fil`), UN region codes (`en-419`) —
   * is intentionally out of scope; relax the regex in lockstep with a
   * resolver update if those become needed. Values are rejected when
   * all whitespace, mirroring `defaultVoice`.
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
   * `instructions` field (OpenAI `gpt-4o-mini-tts`). Steers warmth, pacing,
   * and language consistency. Falls back to no instruction when omitted.
   */
  defaultInstructions: z.string().min(1).max(2000).optional(),
  /**
   * Locale → instructions mapping. Same lookup pattern as `voicesByLocale`:
   * full locale first, then base, then `defaultInstructions`. Each entry
   * should be written in the language it will steer (in-language prompts
   * produce the best results with OpenAI's TTS). Locale-regex shape
   * matches `voicesByLocale` — see its docstring for the BCP-47 subset.
   */
  instructionsByLocale: z
    .record(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
      z.string().min(1).max(2000),
    )
    .optional(),
  /**
   * Output audio format for TTS models. Defaults to mp3 when omitted.
   * `pcm` is raw 24 kHz mono int16 — choose only when the client can
   * play `audio/L16; rate=24000` (most browsers can; some older Safari
   * cannot). `opus` is served as Ogg-Opus container, supported on
   * macOS 14+ / iOS 17+ Safari.
   */
  audioFormat: z.enum(audioFormatLiterals).optional(),
  providerOptions: providerOptionsSchema,
  /**
   * Per-model request-body transform; see `requestBodyMapSchema`. Overrides the
   * provider-level `requestBodyMap` on conflicting sub-keys.
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
     * Each model may override it with its own `secretsEnv`. See
     * `secretsEnvSchema`.
     */
    secretsEnv: secretsEnvSchema.optional(),
    /** Wire format this provider's endpoint speaks; see `apiFormatSchema`. */
    apiFormat: apiFormatSchema.optional(),
    supportsStructuredOutputs: z.boolean().optional(),
    defaults: providerDefaultsSchema.optional(),
    /**
     * Provider-level passthrough applied to every model in this file as a
     * default. Each model entry's own `providerOptions` overrides on
     * conflicting sub-keys. See `providerOptionsSchema` JSDoc above for the
     * deny-list and authoring conventions.
     */
    providerOptions: providerOptionsSchema,
    /**
     * Provider-level request-body transform applied to every model in this file
     * as a default; each model's own `requestBodyMap` overrides on conflicting
     * sub-keys. See `requestBodyMapSchema`.
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
    // config bug surfaces only after a user action. Catching it at
    // config-load time gives operators an immediate, actionable error. Runs
    // regardless of whether `defaults` is present.
    //
    // The path points at the first concretely-missing field (using the
    // `forEach` index, not an O(n²) `indexOf`) so the operator's editor jumps
    // to the right line.
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

/**
 * Resolution status of a `secretsEnv` name for the settings UI (issue #1711).
 * Carries no key material — only whether the name is configured, valid (matches
 * the reserved prefix), and currently resolves. Single canonical shape shared by
 * the server (`readProvider` / `secret_resolver.ts`) and the provider settings UI.
 */
export interface EnvSecretStatus {
  /** The configured env-var name, if any. */
  name?: string;
  /** Whether `name` starts with the reserved `SECRETS_ENV_PREFIX`. */
  allowed: boolean;
  /** Whether the env var currently resolves to a non-empty value. */
  resolved: boolean;
}
