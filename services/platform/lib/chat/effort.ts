/**
 * Reasoning effort — the one translation from the user's five-step scale to a
 * provider's sampling parameters.
 *
 * The UI offers ONE uniform scale — low / medium / high / extra / max — for
 * every model, and this module maps it onto whichever control surface the
 * model's catalog entry declares (`reasoning.knob`):
 *
 *  - No effort picked, or the model declares no `reasoning` capability: the
 *    turn samples at `temperature: 0.7` with the model's own declared
 *    `maxOutputTokens` as the reply ceiling — the catalog is the authority
 *    on capability, never a constant here. 4096 is only the FALLBACK for an
 *    entry that declares nothing. Whatever the source, the ceiling claims at
 *    most half the model's context window, so the reply can never squeeze
 *    the history out of its own turn. An effort passed for a non-reasoning
 *    model is SILENTLY ignored — absence-means-default, never a refusal — so
 *    a sticky pick survives switching to a non-reasoning model without
 *    blocking the send.
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
 *    1024 (the provider minimum). `maxTokens` is the model's full declared
 *    `maxOutputTokens` (budget + 4096 tokens of answer headroom when the
 *    entry declares none), under the same half-window share rule as the
 *    default case — but never below `budget + 1024`, so the INVARIANT
 *    `maxTokens > budgetTokens` holds even for a mis-declared catalog entry
 *    with a tiny output ceiling (providers hard-reject a `max_tokens` at or
 *    under the budget). Temperature is OMITTED entirely: Anthropic rejects
 *    a custom temperature while thinking is enabled.
 *
 * The half-window share above fits the MODEL's own window. When governance
 * shrinks the effective window, {@link fitSamplingToWindow} re-applies the
 * same rule against the shrunk window at the lane.
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

/** The reply ceiling assumed ONLY when the catalog entry declares no
 * `maxOutputTokens` — a declared ceiling always wins, whatever its size —
 * and the default sampling temperature. */
const FALLBACK_MAX_OUTPUT_TOKENS = 4096;
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

/** The output's share of a window: half, so a declared ceiling as large as
 * the window itself can never starve the history's slice of the same turn.
 * Floored at twice the provider-minimum thinking budget so a degenerate
 * window still yields a request every provider accepts. */
function outputShare(window: number): number {
  return Math.max(Math.floor(window / 2), 2 * MIN_THINKING_BUDGET);
}

function defaultSampling(model: ModelCatalogEntry): TurnSampling {
  return {
    maxTokens: Math.min(
      model.maxOutputTokens ?? FALLBACK_MAX_OUTPUT_TOKENS,
      outputShare(model.contextWindow),
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
  // The full declared ceiling — the answer keeps whatever the budget leaves
  // of it — under the same half-window share as the default case, with the
  // `maxTokens > budgetTokens` belt for mis-declared entries.
  const ceiling =
    model.maxOutputTokens ?? budgetTokens + THINKING_ANSWER_HEADROOM;
  const maxTokens = Math.max(
    Math.min(ceiling, outputShare(model.contextWindow)),
    budgetTokens + MIN_THINKING_BUDGET,
  );
  // No temperature: thinking-enabled requests reject a custom one.
  return { maxTokens, reasoning: { kind: 'thinking', budgetTokens } };
}

/**
 * Re-fit a resolved sampling to the turn's EFFECTIVE window — the model's
 * own window shrunk by a governance cap. {@link resolveTurnSampling} already
 * fits the model's declared window; this applies the identical share rule
 * when the lane knows a smaller one, shrinking a thinking budget alongside
 * so the `maxTokens > budgetTokens` invariant survives the squeeze. A
 * sampling that already fits is returned unchanged.
 */
export function fitSamplingToWindow(
  sampling: TurnSampling,
  effectiveWindow: number,
): TurnSampling {
  const cap = outputShare(effectiveWindow);
  if (sampling.maxTokens <= cap) return sampling;
  if (sampling.reasoning?.kind !== 'thinking') {
    return { ...sampling, maxTokens: cap };
  }
  const budgetTokens = Math.max(
    Math.min(sampling.reasoning.budgetTokens, cap - MIN_THINKING_BUDGET),
    MIN_THINKING_BUDGET,
  );
  return {
    ...sampling,
    maxTokens: Math.max(cap, budgetTokens + MIN_THINKING_BUDGET),
    reasoning: { kind: 'thinking', budgetTokens },
  };
}
