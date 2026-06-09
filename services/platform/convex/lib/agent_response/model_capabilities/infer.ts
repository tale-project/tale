/**
 * Family-prefix inference for the two wire-protocol capabilities a model
 * catalog can't report directly: which reasoning *knob* a model accepts and
 * which prompt-caching *mode* it uses.
 *
 * The unified catalog (OpenRouter `/api/v1/models`) reports "reasoning: yes/no"
 * but not whether the model wants `reasoning_effort` vs Anthropic's `thinking`
 * object, and reports nothing about caching at all. These two helpers fill that
 * gap from the model id alone, by family prefix:
 *
 *   - Anthropic (`claude-*`) → `budgetTokens` (self-truncating thinking) +
 *     explicit `cache_control` breakpoints.
 *   - Gemini → explicit breakpoints (via OpenRouter), `effort` knob.
 *   - OpenAI / DeepSeek / Grok → automatic server-side caching, `effort` knob.
 *   - Everything else → `effort` (the openai-compatible default), no caching.
 *
 * Operator provider-config values always win over these guesses; this is only
 * the fallback used while normalizing a freshly-fetched catalog entry.
 */

import type {
  PromptCachingCapabilityConfig,
  ReasoningCapabilityConfig,
} from '../../../../lib/shared/schemas/providers';
import { stripProviderPrefix } from '../../../../lib/shared/utils/model-ref';

/** Anthropic caps `cache_control` markers at 4. */
const ANTHROPIC_BREAKPOINTS = 4;

/**
 * Infer the reasoning-control KNOB for a model the catalog reports as
 * reasoning-capable. Anthropic-family → `budgetTokens` (self-truncating
 * thinking, provider-mandated ≥1024 minimum); everything else on the
 * openai-compatible surface → `effort` (`reasoning_effort`).
 */
export function inferReasoningKnob(modelId: string): ReasoningCapabilityConfig {
  const bare = stripProviderPrefix(modelId);
  if (bare.startsWith('claude-')) {
    return { knob: 'budgetTokens', minBudgetTokens: 1024 };
  }
  return { knob: 'effort' };
}

/**
 * Infer the prompt-caching mode for a model. Anthropic / Gemini → explicit
 * `cache_control` breakpoints; OpenAI / DeepSeek / Grok → automatic server-side
 * caching; everything else → undefined (treated as `none`, never risk a reject).
 */
export function inferPromptCachingMode(
  modelId: string,
): PromptCachingCapabilityConfig | undefined {
  const bare = stripProviderPrefix(modelId);
  if (/^(claude-|gemini)/.test(bare)) {
    return {
      mode: 'explicit-breakpoints',
      maxBreakpoints: ANTHROPIC_BREAKPOINTS,
    };
  }
  if (/^(gpt-|o[1345]|deepseek|grok-)/.test(bare)) {
    return { mode: 'auto-server' };
  }
  return undefined;
}
