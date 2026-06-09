/**
 * Prompt-caching middleware (the core of the generic cache layer).
 *
 * A `LanguageModelV3Middleware` factory bound to a resolved model. It runs in
 * `transformParams` — after the AI SDK has built the standardized `params`
 * (`system` is already a single system message at the head of `params.prompt`)
 * but BEFORE the openai-compatible adapter serializes it to the wire — so it is
 * the one place with access to the full message array AND the provider family.
 *
 * Behaviour by strategy (`./strategy`):
 *   - 'explicit-breakpoints' (Anthropic / Gemini via OpenRouter): split the
 *     system message at the cache marker into a cacheable STABLE system message
 *     (tagged `cache_control: { type: 'ephemeral' }`) + a volatile one. The
 *     gateway caches everything up to the breakpoint (tools + the stable system
 *     prefix), so repeat turns reuse it. We place at most one breakpoint here —
 *     the conversation tail is volatile under this app's context model
 *     (`recentMessages: 0`; history lives in the volatile system tail), so a
 *     second breakpoint would never hit.
 *   - 'auto-server' (OpenAI / DeepSeek): strip the marker (the stable prefix is
 *     cached server-side automatically) and attach a deterministic
 *     `prompt_cache_key` derived from the stable prefix to improve cache
 *     routing/hit-rate.
 *   - 'none' (unknown model): strip the marker; emit nothing extra.
 *
 * The marker is ALWAYS removed/normalized so non-caching providers receive the
 * byte-identical prompt they got before this layer existed. Inputs are never
 * mutated in place (the AI SDK may reuse `params`); a shallow-cloned `prompt`
 * and `providerOptions` are returned.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Middleware,
  LanguageModelV3Prompt,
  SharedV3ProviderOptions,
} from '@ai-sdk/provider';

import { splitSystemPromptAtBreakpoint, stripCacheBreakpoint } from './markers';
import { resolvePromptCaching, type PromptCachingModelData } from './strategy';

/**
 * Minimum stable-prefix length (chars) before we place a cache breakpoint.
 * Anthropic only caches blocks above a token floor (~1024 for Sonnet/Opus);
 * ~4 chars/token makes 4096 a safe, conservative gate so we never spend a
 * breakpoint on an uncacheable block.
 */
const MIN_CACHEABLE_CHARS = 4096;

const EPHEMERAL = { type: 'ephemeral' } as const;

/** The provider-options namespace the openai-compatible adapter passes through
 * raw onto each wire message/part (verified in the adapter's
 * `getOpenAIMetadata`). NOT the provider name. */
const PASSTHROUGH_KEY = 'openaiCompatible';

/** Deterministic 32-bit FNV-1a hash → 8-char hex. Pure; no Date/random/crypto,
 * so it is safe in every Convex runtime and stable across turns. */
function hashHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface CacheableModelData extends PromptCachingModelData {
  providerName: string;
}

export function createCacheControlMiddleware(
  modelData: CacheableModelData,
): LanguageModelV3Middleware {
  const strategy = resolvePromptCaching(modelData);

  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => transform(params),
  };

  function transform(
    params: LanguageModelV3CallOptions,
  ): LanguageModelV3CallOptions {
    const { prompt } = params;
    const sysIndex = prompt.findIndex((m) => m.role === 'system');
    // No system message → no marker to strip and no prefix to cache.
    if (sysIndex === -1) return params;

    const systemMessage = prompt[sysIndex];
    if (systemMessage.role !== 'system') return params;
    const split = splitSystemPromptAtBreakpoint(systemMessage.content);

    const canCache =
      strategy.mode === 'explicit-breakpoints' &&
      split.hadMarker &&
      strategy.maxBreakpoints > 0 &&
      split.stable.length >= MIN_CACHEABLE_CHARS;

    if (canCache) {
      // Split into a cacheable stable system message + a volatile one. Omit the
      // volatile message entirely when it's empty (marker at the very end), so
      // we never emit a zero-content system message some providers reject.
      const stableMsg = {
        role: 'system' as const,
        content: split.stable,
        providerOptions: { [PASSTHROUGH_KEY]: { cache_control: EPHEMERAL } },
      };
      return replaceSystem(
        params,
        prompt,
        sysIndex,
        split.volatile.length > 0
          ? [stableMsg, { role: 'system', content: split.volatile }]
          : [stableMsg],
      );
    }

    // Every non-caching path emits one clean system message with the marker
    // rejoined to its original separator.
    const cleaned = replaceSystem(params, prompt, sysIndex, [
      { role: 'system', content: stripCacheBreakpoint(systemMessage.content) },
    ]);

    if (strategy.mode === 'auto-server' && split.hadMarker) {
      // Key the server-side cache on the STABLE prefix only. With no marker the
      // prompt has no stable/volatile split (e.g. a non-cacheable, time-varying
      // prompt), so keying off the whole — volatile — system would change the
      // key every turn and defeat the hint; skip it and let the provider
      // auto-detect its own longest stable prefix.
      return withProviderOption(
        cleaned,
        modelData.providerName,
        'prompt_cache_key',
        `tale-${hashHex(split.stable)}`,
      );
    }
    return cleaned;
  }
}

/** Return new params with the system message at `index` replaced by `replacement`
 * (one or more messages). Clones the prompt array; never mutates the input. */
function replaceSystem(
  params: LanguageModelV3CallOptions,
  prompt: LanguageModelV3Prompt,
  index: number,
  replacement: LanguageModelV3Prompt,
): LanguageModelV3CallOptions {
  const next = [
    ...prompt.slice(0, index),
    ...replacement,
    ...prompt.slice(index + 1),
  ];
  return { ...params, prompt: next };
}

/** Return new params with `providerOptions[providerName][key] = value`, cloning
 * each level so the input options are never mutated. */
function withProviderOption(
  params: LanguageModelV3CallOptions,
  providerName: string,
  key: string,
  value: string,
): LanguageModelV3CallOptions {
  const base: SharedV3ProviderOptions = params.providerOptions ?? {};
  const providerLevel = base[providerName] ?? {};
  return {
    ...params,
    providerOptions: {
      ...base,
      [providerName]: { ...providerLevel, [key]: value },
    },
  };
}
