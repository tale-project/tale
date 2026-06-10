/**
 * Layer B — capability gating and knob selection.
 *
 * Decides, for a concrete model, *whether* it can be told how hard to reason
 * and *which* control surface it exposes. Resolution order:
 *
 *   1. `modelData.reasoning` — the resolved capability (operator provider JSON,
 *      with the OpenRouter catalog cache layered under it in
 *      `providers/file_actions.ts`). Explicit, always wins.
 *   2. null — no declared capability: emit nothing, never risk a provider
 *      rejecting a reasoning parameter it doesn't understand
 *
 * The knob distinguishes the two real-world shapes the openai-compatible
 * adapter can carry:
 *   - 'effort'       → body `reasoning_effort: 'minimal'|'low'|'medium'|'high'`
 *                      (OpenAI o-series / gpt-5 / gpt-oss / Grok / Gemini via
 *                      OpenRouter; the SDK maps `reasoningEffort`)
 *   - 'budgetTokens' → body `thinking: { type:'enabled', budget_tokens }`
 *                      (Anthropic extended thinking; the model self-truncates)
 */

import type { ReasoningCapabilityConfig } from '../../../../lib/shared/schemas/providers';
import type { ReasoningTier } from './types';

/** Re-exported so call sites can import config + governor types from one place. */
export type { ReasoningCapabilityConfig };

type ReasoningKnob = 'effort' | 'budgetTokens';

export interface ReasoningCapability {
  knob: ReasoningKnob;
  /**
   * Whether the model spends its budget elastically and stops on its own
   * (Anthropic-style thinking) vs. tending to fill whatever tier it's given
   * (OpenAI effort tiers). This drives the controller: a self-truncating
   * model's usage *reveals* its need (estimate directly); a tier-filling
   * model's usage is uninformative about the minimum, so the controller must
   * probe lower tiers and watch outcomes instead.
   */
  selfTruncates: boolean;
  /** effort-only: the model supports the `'minimal'` floor (gpt-5 family). */
  supportsMinimal?: boolean;
  /** budgetTokens-only: provider-mandated minimum (Anthropic requires ≥1024). */
  minBudgetTokens?: number;
  /** budgetTokens-only: a hard ceiling for the thinking budget, if known. */
  maxBudgetTokens?: number;
}

/** Shape this layer needs from a resolved model. */
interface ReasoningModelData {
  modelId: string;
  /** Operator-declared capability (highest precedence). */
  reasoning?: ReasoningCapabilityConfig;
}

/** Budget-token (Anthropic-style) models self-truncate; effort tiers fill up. */
function withSelfTruncates(
  capability: Omit<ReasoningCapability, 'selfTruncates'>,
): ReasoningCapability {
  return { ...capability, selfTruncates: capability.knob === 'budgetTokens' };
}

function fromConfig(
  cfg: ReasoningCapabilityConfig,
): ReasoningCapability | null {
  if (cfg.knob === 'none') return null;
  return withSelfTruncates({
    knob: cfg.knob,
    supportsMinimal: cfg.supportsMinimal,
    minBudgetTokens: cfg.minBudgetTokens,
    maxBudgetTokens: cfg.maxBudgetTokens,
  });
}

/**
 * Resolve the reasoning capability for a model, or `null` when reasoning
 * should not be steered (no declared capability, or operator-disabled via
 * `'none'`). The capability arrives already resolved on `modelData.reasoning`
 * (operator provider JSON, catalog cache layered under it); there is no
 * built-in family fallback here any more.
 */
export function resolveReasoningCapability(
  modelData: ReasoningModelData,
): ReasoningCapability | null {
  const cfg = modelData.reasoning;
  if (cfg) return fromConfig(cfg);
  return null;
}

/**
 * Map a canonical tier to the openai-compatible `reasoning_effort` value for
 * effort-knob models. `'off'` becomes the model's minimal floor.
 */
export function tierToEffort(
  tier: ReasoningTier,
  supportsMinimal: boolean | undefined,
): 'minimal' | 'low' | 'medium' | 'high' {
  if (tier === 'off') return supportsMinimal ? 'minimal' : 'low';
  // tier is narrowed to 'low' | 'medium' | 'high', which the return type covers.
  return tier;
}
