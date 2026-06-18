'use node';

/**
 * Shared helpers for resolving provider models and creating language model instances.
 *
 * Centralizes the resolve → create-provider → get-model pattern used across
 * the codebase, eliminating the repeated type assertions and boilerplate.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type {
  ImageModelV3,
  LanguageModelV3,
  LanguageModelV3Middleware,
} from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';

import type { Domain } from '../../lib/shared/constants/domains';
import type {
  ModelTier,
  PromptCachingCapabilityConfig,
  ReasoningCapabilityConfig,
} from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { createCacheControlMiddleware } from '../lib/agent_response/prompt_caching/middleware';
import {
  interleavedThinkingHeaders,
  providerAttributionHeaders,
} from './provider_attribution';
import { createWireTransformFetch } from './request_body_transform';

export interface ResolvedModelData {
  providerName: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  /**
   * Effective wire format (model override ?? provider ?? 'openai'). The chat
   * factory is OpenAI-compatible-only today, so this is informational for the
   * chat path (an 'anthropic' provider falls back to the OpenAI client and
   * errors at the wire level); the external-agent gateway uses it to pick the
   * Bifrost base_provider_type. See `apiFormatSchema` in shared/schemas.
   */
  apiFormat: 'openai' | 'anthropic';
  tags: string[];
  dimensions?: number;
  maxOutputTokens?: number;
  supportsStructuredOutputs: boolean;
  imageGenerationMode?: 'images-api' | 'chat-multimodal';
  /** Transcription-only: HTTP request convention (`multipart` Whisper-style vs
   * `json-base64` OpenRouter-style). Absent ⇒ `multipart`. */
  transcriptionMode?: 'multipart' | 'json-base64';
  inputCentsPerMillion?: number;
  outputCentsPerMillion?: number;
  /** For per-image pricing (image-generation models). Complements the token
   * fields above, which remain the cost source for chat/embedding models. */
  imageCentsPerImage?: number;
  /** For per-minute pricing (transcription models, e.g. OpenAI whisper-1). */
  centsPerAudioMinute?: number;
  /** For per-character pricing (TTS models, e.g. OpenAI gpt-4o-mini-tts). */
  centsPerMillionCharacters?: number;
  /** TTS-only: default voice when no locale entry matches. */
  defaultVoice?: string;
  /** TTS-only: locale → voice mapping. */
  voicesByLocale?: Record<string, string>;
  /** TTS-only: default natural-language tone/style prompt when no locale
   * entry matches. Steers warmth, pacing, and language consistency for
   * provider models that accept an `instructions` field (e.g. OpenAI
   * `gpt-4o-mini-tts`). Undefined when not configured. */
  defaultInstructions?: string;
  /** TTS-only: locale → instructions mapping. Same lookup pattern as
   * `voicesByLocale`. Each entry should be written in the language it
   * steers. */
  instructionsByLocale?: Record<string, string>;
  /** TTS-only: response audio format the provider should return. */
  audioFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  /**
   * Resolver-merged passthrough (provider-level + model-level, depth-2 merged
   * with model-level winning). Authored as the inner body shape (e.g.
   * `{ provider: { quantizations: ['fp8'] } }`); the call-site helper
   * `buildCallProviderOptions` namespaces it under `providerName` and applies
   * the deny-list strip before handing it to streamText/generateText.
   */
  providerOptions?: Record<string, unknown>;
  /**
   * Resolver-merged request-body transform (provider-level ⊕ model-level via
   * `mergeModelLevel`). Applied to the final serialized wire body by
   * `createWireTransformFetch` — renames/removes fields for endpoints whose wire
   * shape differs (e.g. `max_tokens` → `max_completion_tokens` for reasoning
   * deployments). Top-level (not inside `providerOptions`) because, unlike
   * providerOptions, it must NOT reach the provider. See `requestBodyMapSchema`.
   */
  requestBodyMap?: { rename?: Record<string, string>; remove?: string[] };
  /**
   * Resolved reasoning capability for the Adaptive Reasoning Governor (operator
   * provider JSON, with the OpenRouter catalog cache layered under it). Absent
   * ⇒ reasoning is not steered. See `lib/agent_response/reasoning/capability.ts`.
   */
  reasoning?: ReasoningCapabilityConfig;
  /**
   * Resolved prompt-caching capability for the generic cache layer (operator
   * provider JSON, catalog cache layered under it). Absent ⇒ 'none'. See
   * `lib/agent_response/prompt_caching/strategy.ts`.
   */
  promptCaching?: PromptCachingCapabilityConfig;
  /**
   * Operator-declared routing/cascade metadata (provider JSON). All optional;
   * consumed by complexity-based model routing and the speculative cascade.
   * `tier` falls back to cost-inference, `qualityScore` to 0, `routingTags` to
   * none. Vision capability is read from the `'vision'` tag, not a flag here.
   */
  tier?: ModelTier;
  qualityScore?: number;
  routingTags?: Domain[];
  contextWindow?: number;
}

interface ResolvedLanguageModel {
  languageModel: LanguageModelV3;
  modelData: ResolvedModelData;
}

/**
 * Outcome of resolving an image-generation model. Branches on the model's
 * `imageGenerationMode`:
 * - `'images-api'`: uses `/v1/images/generations` via `generateImage()`
 *   (FLUX, Imagen).
 * - `'chat-multimodal'`: uses `/v1/chat/completions` with image parts,
 *   images returned in `result.files` (Nano Banana, GPT-Image).
 */
export type ResolvedImageModel =
  | {
      kind: 'images-api';
      imageModel: ImageModelV3;
      modelData: ResolvedModelData;
    }
  | {
      kind: 'chat-multimodal';
      languageModel: LanguageModelV3;
      modelData: ResolvedModelData;
    };

/**
 * Workaround: Flatten tool inputSchemas that use `oneOf`/`anyOf` at the root.
 *
 * PROBLEM:
 * Many of our agent tools use `z.discriminatedUnion()` (zod v4) for their
 * input schemas. When the AI SDK converts these to JSON Schema, the result
 * is `{ "oneOf": [...] }` — a valid JSON Schema, but OpenAI's API rejects
 * schemas that have `oneOf`/`anyOf`/`allOf` at the top level:
 *
 *   "Invalid schema for function 'rag_search': schema must have type 'object'
 *    and not have 'oneOf'/'anyOf'/'allOf'/'enum'/'not' at the top level."
 *
 * UPSTREAM BUG:
 * This is tracked as vercel/ai#7924. Multiple fix PRs exist (#12283, #12942,
 * #13217) but none have been merged as of 2026-04-10.
 *
 * FIX:
 * We merge all `oneOf`/`anyOf` variant schemas into a single flat object
 * schema. Properties from all variants are combined (all made optional since
 * each variant only uses a subset). The `required` array is set to the
 * intersection of all variants' required fields (typically just the
 * discriminator like `operation`).
 *
 * This preserves the LLM's ability to understand the schema via the tool
 * description while satisfying OpenAI's strict schema requirements.
 *
 * REMOVAL:
 * Delete this middleware once the upstream fix lands in the `ai` package and
 * we upgrade past it.
 *
 * @see https://github.com/vercel/ai/issues/7924
 */

type JSONSchema7Object = Record<string, unknown>;

/**
 * Merge oneOf/anyOf variant schemas into a single flat object schema.
 * All properties become optional except those required by every variant
 * (typically just the discriminator field like `operation`).
 */
function flattenUnionSchema(schema: JSONSchema7Object): JSONSchema7Object {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON Schema oneOf/anyOf are arrays of schema objects
  const variants = (schema.oneOf ?? schema.anyOf) as
    | JSONSchema7Object[]
    | undefined;
  if (!variants || variants.length === 0) return schema;

  const mergedProperties: Record<string, unknown> = {};
  const requiredSets: Set<string>[] = [];
  // Track `const` values per property so we can merge them into `enum`
  const constValues: Record<string, unknown[]> = {};

  for (const variant of variants) {
    if (typeof variant !== 'object' || variant === null) continue;

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON Schema properties is Record<string, unknown>
    const props = variant.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        const propObj =
          typeof value === 'object' && value !== null
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof/null check
              (value as Record<string, unknown>)
            : null;

        // Collect `const` values across variants for the same property
        // (e.g., operation: { const: "search" } + operation: { const: "list" }
        //  → operation: { enum: ["search", "list"] })
        if (propObj && 'const' in propObj) {
          if (!constValues[key]) constValues[key] = [];
          constValues[key].push(propObj.const);
        }

        if (!(key in mergedProperties)) {
          mergedProperties[key] = value;
        }
      }
    }

    const req = variant.required;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON Schema required is string[]
    requiredSets.push(new Set(Array.isArray(req) ? (req as string[]) : []));
  }

  // Replace `const` with `enum` for properties that had different const values
  // across variants (typically the discriminator field like "operation")
  for (const [key, values] of Object.entries(constValues)) {
    if (values.length > 1) {
      const existing =
        typeof mergedProperties[key] === 'object' &&
        mergedProperties[key] !== null
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof/null check
            (mergedProperties[key] as Record<string, unknown>)
          : {};
      const { const: _removed, ...rest } = existing;
      mergedProperties[key] = { ...rest, enum: values };
    }
  }

  // Only fields required by ALL variants stay required (usually just the
  // discriminator like "operation")
  const commonRequired =
    requiredSets.length > 0
      ? [...requiredSets[0]].filter((field) =>
          requiredSets.every((s) => s.has(field)),
        )
      : [];

  return {
    type: 'object' as const,
    properties: mergedProperties,
    ...(commonRequired.length > 0 ? { required: commonRequired } : {}),
    additionalProperties: false,
  };
}

const toolSchemaFixMiddleware: LanguageModelV3Middleware = {
  specificationVersion: 'v3',
  transformParams: async ({ params }) => {
    if (!params.tools) return params;

    return {
      ...params,
      tools: params.tools.map((tool) => {
        if (tool.type !== 'function') return tool;

        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSONSchema7 is a Record-like object
        const schema = tool.inputSchema as JSONSchema7Object | undefined;
        if (!schema) return tool;

        // Only flatten schemas that have oneOf/anyOf at the root — these come
        // from z.discriminatedUnion() / z.union() and are rejected by OpenAI.
        // Schemas that already have type:"object" are left untouched.
        if (schema.oneOf || schema.anyOf) {
          return { ...tool, inputSchema: flattenUnionSchema(schema) };
        }
        return tool;
      }),
    };
  },
};

/**
 * Optional fetch wrapper for `TALE_DEBUG_LLM_WIRE=1` — logs outgoing chat,
 * embedding, and image LLM requests routed through the AI SDK's openai-
 * compatible client.
 *
 * SCOPE — what is covered:
 * - Chat (`/v1/chat/completions`) and embeddings (`/v1/embeddings`)
 * - Image-generation via `generateImage` and chat-multimodal
 *
 * SCOPE — what is NOT covered (uses raw `fetch` directly):
 * - Transcription (`/v1/audio/transcriptions`)
 * - The direct OpenRouter image-fetch path in
 *   `agents/image_generation/run_image_generation.ts` (multimodal output)
 * - Connection-test and model-discovery probes in
 *   `providers/file_actions.ts`
 *
 * REDACTION — only `messages` and `input` are blanked. Other body fields
 * including `system`, `tools`, `tool_choice`, `metadata`, `prompt_cache_key`,
 * `user`, `prediction` are logged verbatim. Use this flag for development;
 * not appropriate for production logs.
 *
 * Returns `undefined` when the flag is unset so the SDK uses its default
 * `globalThis.fetch`.
 */
type FetchFn = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => Promise<Response>;

function createDebugFetch(providerName: string): FetchFn | undefined {
  if (process.env.TALE_DEBUG_LLM_WIRE !== '1') return undefined;
  return async (input, init) => {
    try {
      let url: string;
      if (typeof input === 'string') url = input;
      else if (input instanceof URL) url = input.href;
      else url = input.url;
      const bodyText = typeof init?.body === 'string' ? init.body : undefined;
      let parsed: unknown = undefined;
      if (bodyText) {
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          parsed = '[non-JSON body]';
        }
      }
      let redacted: unknown = parsed;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const entries: Array<[string, unknown]> = [];
        for (const [k, v] of Object.entries(parsed)) {
          entries.push(
            k === 'messages' || k === 'input' ? [k, '[REDACTED]'] : [k, v],
          );
        }
        redacted = Object.fromEntries(entries);
      }
      console.debug(
        `[TALE_DEBUG_LLM_WIRE] ${providerName} POST ${url}\n${JSON.stringify(redacted, null, 2)}`,
      );
    } catch (err) {
      console.warn('[TALE_DEBUG_LLM_WIRE] failed to log outgoing request', err);
    }
    return fetch(input, init);
  };
}

/**
 * Build the openai-compatible provider client shared by chat and image
 * resolution. `supportsStructuredOutputs` is only meaningful for chat models,
 * so it's threaded through as an optional flag.
 */
function createCompatibleProvider(
  modelData: ResolvedModelData,
  opts?: { supportsStructuredOutputs?: boolean },
) {
  // apiFormat seam (chat path): only the OpenAI-compatible wire format is
  // implemented here today, so EVERY provider falls back to this client. An
  // `apiFormat: 'anthropic'` provider therefore reaches the OpenAI-compatible
  // client and will error at the wire level if used in chat — that is a
  // user-owned misconfiguration (the external-agent gateway handles anthropic
  // natively). To support anthropic chat models later, branch here:
  //   if (modelData.apiFormat === 'anthropic') return createAnthropicProvider(modelData);
  // (add `@ai-sdk/anthropic` + gate the OpenAI-REST-only resolvers — image /
  // embeddings / transcription / TTS — for anthropic providers).
  // Always install the wire-transform fetch (it applies requestBodyMap +
  // the reasoning max_tokens→max_completion_tokens default) and compose the
  // optional wire-debug logger inside it so logs reflect the transformed body.
  // When the model has no transform work the helper returns the inner/global
  // fetch unchanged, so there's zero overhead on the common path.
  const wireFetch = createWireTransformFetch(
    modelData,
    createDebugFetch(modelData.providerName),
  );
  return createOpenAICompatible({
    name: modelData.providerName,
    baseURL: modelData.baseUrl,
    apiKey: modelData.apiKey,
    headers: {
      ...providerAttributionHeaders(modelData),
      ...interleavedThinkingHeaders(modelData),
    },
    ...(opts?.supportsStructuredOutputs !== undefined
      ? { supportsStructuredOutputs: opts.supportsStructuredOutputs }
      : {}),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @ai-sdk/openai-compatible types `fetch` as `typeof fetch` which carries an irrelevant `preconnect` static; the wrapped function is structurally compatible for runtime fetch calls
    fetch: wireFetch as typeof fetch,
  });
}

export function createLanguageModel(
  modelData: ResolvedModelData,
): LanguageModelV3 {
  // Reject a malformed/missing baseURL at resolution time so a wrongly
  // configured provider is skipped to the next fallback model WITHOUT a doomed
  // network request (see the fallback loop in agent_chat/internal_actions.ts).
  try {
    void new URL(modelData.baseUrl);
  } catch {
    throw new Error(
      `Invalid baseURL for provider '${modelData.providerName}': ${modelData.baseUrl || '(empty)'}`,
    );
  }
  const provider = createCompatibleProvider(modelData, {
    supportsStructuredOutputs: modelData.supportsStructuredOutputs,
  });
  return wrapLanguageModel({
    model: provider.chatModel(modelData.modelId),
    // Order matters: the tool-schema fix normalizes tools first, then the
    // cache-control layer splits/normalizes the system prompt and (for
    // auto-server models) attaches a prompt_cache_key.
    middleware: [
      toolSchemaFixMiddleware,
      createCacheControlMiddleware({
        providerName: modelData.providerName,
        modelId: modelData.modelId,
        promptCaching: modelData.promptCaching,
      }),
    ],
  });
}

// The resolve actions return a structural validator whose inferred type is
// looser than `ResolvedModelData` (e.g. `Record<string, any>` providerOptions,
// un-branded routing fields), so both helpers below assert the exact contract
// shape — guaranteed by the file_actions validator.
async function runResolveByTag(
  ctx: ActionCtx,
  args: { tag: string; providerName?: string; organizationId: string },
): Promise<ResolvedModelData> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action validator type is structurally compatible but looser than ResolvedModelData
  return (await ctx.runAction(
    internal.providers.file_actions.resolveModelByTag,
    args,
  )) as ResolvedModelData;
}

async function runResolveById(
  ctx: ActionCtx,
  args: { modelId: string; providerName?: string; organizationId: string },
): Promise<ResolvedModelData> {
  return ctx.runAction(internal.providers.file_actions.resolveModelData, args);
}

/**
 * Resolve the org's transcription model (e.g. whisper-1). Returns bare
 * `ResolvedModelData` — the caller uses `fetch` against
 * `{baseUrl}/audio/transcriptions` directly because `@ai-sdk/openai-compatible`
 * has no transcription primitive.
 *
 * `organizationId` is REQUIRED — multi-org isolation depends on this.
 */
export async function resolveTranscriptionModel(
  ctx: ActionCtx,
  opts: { organizationId: string; providerName?: string },
): Promise<ResolvedModelData> {
  return runResolveByTag(ctx, {
    tag: 'transcription',
    providerName: opts.providerName,
    organizationId: opts.organizationId,
  });
}

export interface ResolvedTtsModel extends ResolvedModelData {
  voice: string;
  audioFormat: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';
  /** Resolved per-locale tone/style prompt. Undefined when the provider
   * config sets neither `instructionsByLocale[locale]` nor
   * `defaultInstructions`; callers must conditionally include this in the
   * upstream request body so non-supporting models never see the field. */
  instructions?: string;
}

/**
 * Resolve the org's text-to-speech model (e.g. OpenAI gpt-4o-mini-tts).
 * Picks a voice by locale: `voicesByLocale[locale]` → base language (e.g.
 * `'de'` from `'de-CH'`) → `defaultVoice`. Throws `UNKNOWN_VOICE` if none
 * of those produce a value.
 *
 * `instructions` follows the same lookup pattern but is purely optional —
 * unset returns `undefined` rather than throwing, so providers that don't
 * configure tone steering keep behaving exactly as before.
 *
 * Returns extended `ResolvedTtsModel` with `voice` and `audioFormat` filled
 * in. Caller posts directly to `{baseUrl}/audio/speech` because the AI SDK
 * has no TTS primitive (same pattern as transcription).
 */
export async function resolveTtsModel(
  ctx: ActionCtx,
  opts: { organizationId: string; locale: string; providerName?: string },
): Promise<ResolvedTtsModel> {
  const modelData = await runResolveByTag(ctx, {
    tag: 'text-to-speech',
    providerName: opts.providerName,
    organizationId: opts.organizationId,
  });

  const baseLocale = opts.locale.split('-')[0];

  const voiceMap = modelData.voicesByLocale ?? {};
  const voice =
    voiceMap[opts.locale] ?? voiceMap[baseLocale] ?? modelData.defaultVoice;
  if (!voice) {
    throw new Error(
      `UNKNOWN_VOICE: model "${modelData.modelId}" has no voice for locale "${opts.locale}" and no defaultVoice configured.`,
    );
  }

  const instructionsMap = modelData.instructionsByLocale ?? {};
  const instructions =
    instructionsMap[opts.locale] ??
    instructionsMap[baseLocale] ??
    modelData.defaultInstructions;

  return {
    ...modelData,
    voice,
    audioFormat: modelData.audioFormat ?? 'mp3',
    instructions,
  };
}

/**
 * Resolve a language model by tag (e.g., 'chat', 'vision').
 * Searches all providers (or a specific one if providerName is given).
 * `organizationId` is REQUIRED — multi-org isolation depends on this.
 */
export async function resolveLanguageModel(
  ctx: ActionCtx,
  opts: { tag: string; providerName?: string; organizationId: string },
): Promise<ResolvedLanguageModel> {
  const modelData = await runResolveByTag(ctx, {
    tag: opts.tag,
    providerName: opts.providerName,
    organizationId: opts.organizationId,
  });
  return { languageModel: createLanguageModel(modelData), modelData };
}

/**
 * Resolve a language model by explicit model ID.
 * Searches all providers (or a specific one if providerName is given).
 * `organizationId` is REQUIRED — multi-org isolation depends on this.
 */
export async function resolveLanguageModelById(
  ctx: ActionCtx,
  opts: { modelId: string; providerName?: string; organizationId: string },
): Promise<ResolvedLanguageModel> {
  const modelData = await runResolveById(ctx, {
    modelId: opts.modelId,
    providerName: opts.providerName,
    organizationId: opts.organizationId,
  });
  return { languageModel: createLanguageModel(modelData), modelData };
}

// ---------------------------------------------------------------------------
// Image model resolution
// ---------------------------------------------------------------------------

/**
 * Build a bare image or language model for direct image generation.
 * No middleware is applied — the chat-schema-fix workaround is tool-specific
 * and irrelevant when no tools are passed.
 */
function buildImageResolution(
  modelData: ResolvedModelData,
): ResolvedImageModel {
  const provider = createCompatibleProvider(modelData);
  if (modelData.imageGenerationMode === 'chat-multimodal') {
    return {
      kind: 'chat-multimodal',
      languageModel: provider.chatModel(modelData.modelId),
      modelData,
    };
  }
  return {
    kind: 'images-api',
    imageModel: provider.imageModel(modelData.modelId),
    modelData,
  };
}

/**
 * Resolve an image-generation model by explicit model ID.
 * Throws if the resolved model lacks the `'image-generation'` tag.
 */
export async function resolveImageModelById(
  ctx: ActionCtx,
  opts: { modelId: string; providerName?: string; organizationId: string },
): Promise<ResolvedImageModel> {
  const modelData = await runResolveById(ctx, {
    modelId: opts.modelId,
    providerName: opts.providerName,
    organizationId: opts.organizationId,
  });
  if (!modelData.tags.includes('image-generation')) {
    throw new Error(
      `Model "${modelData.modelId}" lacks the "image-generation" tag.`,
    );
  }
  return buildImageResolution(modelData);
}

/**
 * Resolve the default image-generation model for the org (or first provider
 * that has one). Uses the `defaults['image-generation']` field when set,
 * otherwise falls back to the first model carrying the tag.
 */
export async function resolveImageModelByTag(
  ctx: ActionCtx,
  opts: { providerName?: string; organizationId: string },
): Promise<ResolvedImageModel> {
  const modelData = await runResolveByTag(ctx, {
    tag: 'image-generation',
    providerName: opts.providerName,
    organizationId: opts.organizationId,
  });
  return buildImageResolution(modelData);
}
