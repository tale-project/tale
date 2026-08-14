/**
 * Reasoning effort — the one translation from the user's five-step scale to a
 * provider's sampling parameters.
 *
 * The UI offers ONE uniform scale — low / medium / high / extra / max — for
 * every model, and this module maps it onto whichever control surface the
 * model's catalog entry declares (`reasoning.knob`):
 *
 *  - No effort picked, or the model declares no `reasoning` capability: the
 *    turn samples exactly as it always has — `temperature: 0.7` and a
 *    `maxTokens` of 4096 (capped by the model's own `maxOutputTokens` when
 *    that is lower). An effort passed for a non-reasoning model is SILENTLY
 *    ignored — absence-means-default, never a refusal — so a sticky pick
 *    survives switching to a non-reasoning model without blocking the send.
 *    ONE addition to the no-pick case: an `effort`-knob model whose catalog
 *    entry declares `reasoning.off` sends that value (`reasoning_effort:
 *    "none"` and friends), so a thinks-by-default model answers the Default
 *    step plainly instead of burning a full thinking pass. No declaration —
 *    including every `budget-tokens` model — keeps the parameter off the
 *    wire exactly as before.
 *
 *  - Knob `effort` (OpenAI-style `reasoning_effort`): providers accept only
 *    three named levels, so the five steps fold to low → low, medium →
 *    medium, and high / extra / max → high. Temperature and the default
 *    `maxTokens` stay as in the default case.
 *
 *  - Knob `budget-tokens` (Anthropic-style extended thinking): each step
 *    names an explicit thinking-token budget (2048 / 8192 / 24576 / 49152 /
 *    98304), clamped to what the model can actually spend — at most
 *    `min(maxOutputTokens ?? 64000, contextWindow / 2) - 1024`, at least
 *    1024 (the provider minimum). `maxTokens` is the budget plus 4096 tokens
 *    of answer headroom, capped at the model's `maxOutputTokens` — but never
 *    below `budget + 1024`, so the INVARIANT `maxTokens > budgetTokens`
 *    holds even for a mis-declared catalog entry with a tiny output ceiling
 *    (providers hard-reject a `max_tokens` at or under the budget).
 *    Temperature is OMITTED entirely: Anthropic rejects a custom temperature
 *    while thinking is enabled.
 *
 * Pure by design — no Convex, no Node, no network — so the whole mapping
 * table lives in one unit-testable file and every lane (direct turn, arena,
 * regenerate) resolves sampling through the same call.
 */

import type { ModelCatalogEntry } from '../shared/schemas/providers';

/** The user-facing scale, in ascending order of effort. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'extra', 'max'] as const;

export type ReasoningEffort = (typeof EFFORT_LEVELS)[number];

export function isReasoningEffort(v: unknown): v is ReasoningEffort {
  return (
    typeof v === 'string' && (EFFORT_LEVELS as readonly string[]).includes(v)
  );
}

/**
 * The sampling parameters one turn sends on the wire. `temperature` is
 * optional because a thinking-enabled request must not carry one; `reasoning`
 * is absent for the plain (non-reasoning) turn.
 */
export interface TurnSampling {
  maxTokens: number;
  temperature?: number;
  reasoning?:
    | {
        kind: 'effort';
        /** A named provider level. The picker produces low/medium/high; the
         * off values come only from a catalog `reasoning.off` declaration. */
        value: 'none' | 'minimal' | 'low' | 'medium' | 'high';
      }
    | { kind: 'thinking'; budgetTokens: number };
}

/** Today's constants, unchanged: the reply ceiling a chat turn uses when the
 * model declares none, and the default sampling temperature. */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/** Answer headroom on top of a thinking budget, and the provider's minimum
 * usable budget. */
const THINKING_ANSWER_HEADROOM = 4096;
const MIN_THINKING_BUDGET = 1024;

/** Five steps → three provider levels: the wire knows only low/medium/high. */
const EFFORT_KNOB_LEVELS: Record<ReasoningEffort, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  extra: 'high',
  max: 'high',
};

/** Five steps → thinking-token budgets, before the per-model clamp. */
const THINKING_BUDGETS: Record<ReasoningEffort, number> = {
  low: 2_048,
  medium: 8_192,
  high: 24_576,
  extra: 49_152,
  max: 98_304,
};

/** The ceiling assumed for a budget clamp when the model declares no
 * `maxOutputTokens` — generous, since budget-knob models routinely allow it. */
const ASSUMED_THINKING_MAX_OUTPUT = 64_000;

function defaultSampling(model: ModelCatalogEntry): TurnSampling {
  return {
    maxTokens: Math.min(
      model.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      DEFAULT_MAX_OUTPUT_TOKENS,
    ),
    temperature: DEFAULT_TEMPERATURE,
  };
}

/**
 * Resolve the sampling for one turn — see the module doc for the semantics.
 * Called once per turn, before streaming; the result rides the model call
 * unchanged.
 */
export function resolveTurnSampling(
  model: ModelCatalogEntry,
  effort?: ReasoningEffort,
): TurnSampling {
  const knob = model.reasoning?.knob;
  if (knob === undefined) return defaultSampling(model);
  if (effort === undefined) {
    // The Default step. An effort-knob model may declare how to switch
    // reasoning OFF (`reasoning.off`); without the declaration the parameter
    // stays off the wire and the provider's own default applies.
    const off = knob === 'effort' ? model.reasoning?.off : undefined;
    return off === undefined
      ? defaultSampling(model)
      : {
          ...defaultSampling(model),
          reasoning: { kind: 'effort', value: off },
        };
  }

  if (knob === 'effort') {
    // A `toolsRequireOff` model's endpoint refuses tools combined with any
    // effort above `off`, and a chat turn always carries tools — so a pick
    // (typically sticky from another model; the picker offers no levels
    // here) falls back to the declared off value, the same
    // absence-means-default semantics a non-reasoning model applies.
    const forcedOff = model.reasoning?.toolsRequireOff
      ? model.reasoning.off
      : undefined;
    return {
      ...defaultSampling(model),
      reasoning: {
        kind: 'effort',
        value: forcedOff ?? EFFORT_KNOB_LEVELS[effort],
      },
    };
  }

  // knob === 'budget-tokens': an explicit thinking budget, clamped to what
  // the model can spend, with guaranteed answer headroom above it.
  const budgetCap =
    Math.floor(
      Math.min(
        model.maxOutputTokens ?? ASSUMED_THINKING_MAX_OUTPUT,
        model.contextWindow / 2,
      ),
    ) - MIN_THINKING_BUDGET;
  const budgetTokens = Math.max(
    Math.min(THINKING_BUDGETS[effort], budgetCap),
    MIN_THINKING_BUDGET,
  );
  const uncapped = budgetTokens + THINKING_ANSWER_HEADROOM;
  const maxTokens =
    model.maxOutputTokens !== undefined
      ? Math.max(
          Math.min(uncapped, model.maxOutputTokens),
          budgetTokens + MIN_THINKING_BUDGET,
        )
      : uncapped;
  // No temperature: thinking-enabled requests reject a custom one.
  return { maxTokens, reasoning: { kind: 'thinking', budgetTokens } };
}
