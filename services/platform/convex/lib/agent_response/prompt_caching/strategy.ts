/**
 * Prompt-caching strategy resolution (pure).
 *
 * Decides, for a concrete model, HOW its stable prompt prefix should be cached
 * so repeat turns are cheaper and lower-latency. Everything routes through the
 * `@ai-sdk/openai-compatible` adapter (default gateway OpenRouter), so the two
 * real-world shapes are:
 *
 *   - 'explicit-breakpoints' → Anthropic / Gemini need `cache_control` markers
 *     injected on message content; the gateway caches the prefix up to each
 *     breakpoint. The middleware (`./middleware`) injects them.
 *   - 'auto-server'          → OpenAI / DeepSeek cache a stable prefix on their
 *     side automatically; we only attach a `prompt_cache_key` routing hint.
 *   - 'none'                 → unknown model: emit nothing, never risk a
 *     provider rejecting a field it doesn't understand.
 *
 * Resolution order mirrors `reasoning/capability.ts`:
 *   1. `modelData.promptCaching` — the resolved capability (operator provider
 *      JSON, with the OpenRouter catalog cache layered under it in
 *      `providers/file_actions.ts`). Explicit, always wins.
 *   2. 'none' — no declared capability: emit nothing, never risk a provider
 *      rejecting a field it doesn't understand.
 *
 * Pure and synchronous (no IO), so it adds no latency and is unit-testable.
 */

import type { PromptCachingCapabilityConfig } from '../../../../lib/shared/schemas/providers';

interface PromptCachingStrategy {
  mode: PromptCachingCapabilityConfig['mode'];
  /** Max `cache_control` markers to inject (explicit-breakpoints only). */
  maxBreakpoints: number;
}

/** Shape this layer needs from a resolved model. */
export interface PromptCachingModelData {
  modelId: string;
  /** Operator-declared capability (highest precedence). */
  promptCaching?: PromptCachingCapabilityConfig;
}

/**
 * Anthropic allows up to 4 cache breakpoints. We place at most 2 (system +
 * last stable turn), but keep the family ceiling so an operator override or a
 * future placement can use the full budget.
 */
const ANTHROPIC_MAX_BREAKPOINTS = 4;

/**
 * Resolve the prompt-caching strategy for a model. The capability arrives
 * already resolved on `modelData.promptCaching` (operator provider JSON, with
 * the catalog cache layered under it); otherwise 'none' (the safe default).
 */
export function resolvePromptCaching(
  modelData: PromptCachingModelData,
): PromptCachingStrategy {
  const cfg = modelData.promptCaching;
  if (!cfg) return { mode: 'none', maxBreakpoints: 0 };
  return {
    mode: cfg.mode,
    maxBreakpoints:
      cfg.mode === 'explicit-breakpoints'
        ? (cfg.maxBreakpoints ?? ANTHROPIC_MAX_BREAKPOINTS)
        : 0,
  };
}
