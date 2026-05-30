/**
 * Layer B — capability gating and knob selection.
 *
 * Decides, for a concrete model, *whether* it can be told how hard to reason
 * and *which* control surface it exposes. Resolution order:
 *
 *   1. operator config  (`modelData.reasoning`) — explicit, always wins
 *   2. built-in curated table (by model id) — makes the feature work
 *      out-of-the-box for the common reasoning families
 *   3. null — unknown model: emit nothing, never risk a provider rejecting a
 *      reasoning parameter it doesn't understand
 *
 * The knob distinguishes the two real-world shapes the openai-compatible
 * adapter can carry:
 *   - 'effort'       → body `reasoning_effort: 'minimal'|'low'|'medium'|'high'`
 *                      (OpenAI o-series / gpt-5; the SDK maps `reasoningEffort`)
 *   - 'budgetTokens' → body `thinking: { type:'enabled', budget_tokens }`
 *                      (Anthropic extended thinking; the model self-truncates)
 */

import type { ReasoningCapabilityConfig } from '../../../../lib/shared/schemas/providers';
import type { ReasoningTier } from './types';

/** Re-exported so call sites can import config + governor types from one place. */
export type { ReasoningCapabilityConfig };

export type ReasoningKnob = 'effort' | 'budgetTokens';

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
export interface ReasoningModelData {
  modelId: string;
  /** Operator-declared capability (highest precedence). */
  reasoning?: ReasoningCapabilityConfig;
}

interface CuratedEntry {
  test: RegExp;
  /** `selfTruncates` is derived from the knob, so entries omit it. */
  capability: Omit<ReasoningCapability, 'selfTruncates'>;
}

/** Budget-token (Anthropic-style) models self-truncate; effort tiers fill up. */
function withSelfTruncates(
  capability: Omit<ReasoningCapability, 'selfTruncates'>,
): ReasoningCapability {
  return { ...capability, selfTruncates: capability.knob === 'budgetTokens' };
}

/**
 * Curated families where a known knob actually controls reasoning. Kept
 * deliberately conservative: a model only belongs here if sending the mapped
 * parameter is known-safe. Anything else falls through to `null`.
 *
 * Matches the bare model id; provider prefixes (e.g. `openai/`, `anthropic/`
 * from OpenRouter-style ids) are stripped before matching.
 */
const CURATED: CuratedEntry[] = [
  // OpenAI reasoning models — `reasoning_effort`. gpt-5* adds the 'minimal' floor.
  { test: /^gpt-5/, capability: { knob: 'effort', supportsMinimal: true } },
  { test: /^o[1345](-|$|\b)/, capability: { knob: 'effort' } },
  { test: /^o4-mini/, capability: { knob: 'effort' } },
  // Anthropic extended-thinking models — `thinking.budget_tokens`.
  {
    test: /^claude-(3-7|sonnet-4|opus-4|haiku-4|3\.7|opus-4|sonnet-4)/,
    capability: { knob: 'budgetTokens', minBudgetTokens: 1024 },
  },
  // Explicit opt-in suffix some gateways expose.
  {
    test: /(:thinking|-thinking)$/,
    capability: { knob: 'budgetTokens', minBudgetTokens: 1024 },
  },
];

function stripProviderPrefix(modelId: string): string {
  // OpenRouter-style ids look like `anthropic/claude-sonnet-4`; the family
  // signal is the segment after the last slash.
  const slash = modelId.lastIndexOf('/');
  const bare = slash >= 0 ? modelId.slice(slash + 1) : modelId;
  return bare.toLowerCase();
}

/**
 * Resolve the reasoning capability for a model, or `null` when reasoning
 * should not be steered (unknown model, or operator-disabled via `'none'`).
 */
export function resolveReasoningCapability(
  modelData: ReasoningModelData,
): ReasoningCapability | null {
  const cfg = modelData.reasoning;
  if (cfg) {
    if (cfg.knob === 'none') return null;
    return withSelfTruncates({
      knob: cfg.knob,
      supportsMinimal: cfg.supportsMinimal,
      minBudgetTokens: cfg.minBudgetTokens,
      maxBudgetTokens: cfg.maxBudgetTokens,
    });
  }

  const bare = stripProviderPrefix(modelData.modelId);
  for (const entry of CURATED) {
    if (entry.test.test(bare)) return withSelfTruncates(entry.capability);
  }
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
