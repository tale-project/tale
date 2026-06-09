/**
 * Context-budget + compaction-trigger math (pure, zero-IO).
 *
 * The conversation-history budget scales with the model's real context window
 * (capped) instead of the old fixed 25K, so a long chat actually fills the
 * window — and the auto-compaction governor (see `./summarize`) folds the
 * oldest turns into a rolling summary once that budget is ~90% full, instead of
 * silently dropping them (the previous `loadPrioritizedMessages` behaviour).
 *
 * When a model declares no context window (unknown family / sparse catalog row)
 * we fall back to a sensible default; callers that have the agent's model list
 * may instead interpolate one via `model_metadata.ts`.
 */

import {
  DEFAULT_MAX_HISTORY_TOKENS,
  DEFAULT_MODEL_CONTEXT_LIMIT,
} from '../constants';

/**
 * Fraction of the model's context window conversation history may occupy. The
 * remainder is left for the stable system prefix (agent identity, tools, RAG /
 * web context), the rolling summary, and the model's own output.
 */
const HISTORY_WINDOW_UTILIZATION = 0.6;

/** Hard ceiling on the history budget regardless of window size (cost guard). */
export const MAX_HISTORY_BUDGET_TOKENS = 96_000;

/** Compact once the real prompt input reaches this fraction of the budget. */
export const COMPACTION_TRIGGER_RATIO = 0.9;

/**
 * Of the budget, keep this most-recent fraction verbatim when compacting;
 * everything older is folded into the rolling summary. Keeping a healthy recent
 * window verbatim preserves the immediate conversational detail the model needs.
 */
export const KEEP_RECENT_RATIO = 0.35;

interface ContextBudgetInput {
  /** Model context window in tokens. Falsy → `DEFAULT_MODEL_CONTEXT_LIMIT`. */
  contextWindow?: number;
  /** Governance-resolved max context tokens — a hard cap (may be below floor). */
  governanceMaxContext?: number;
  /** Per-agent floor (today's static history budget); the result never dips
   *  below this so existing small-window behaviour is preserved. */
  agentDefault?: number;
}

/** Model context window, falling back to the default when unknown/non-positive. */
function resolveWindow(contextWindow: number | undefined): number {
  return contextWindow && contextWindow > 0
    ? contextWindow
    : DEFAULT_MODEL_CONTEXT_LIMIT;
}

/**
 * Resolve the conversation-history token budget for a turn. Scales with the
 * model's context window (× {@link HISTORY_WINDOW_UTILIZATION}), clamped to
 * `[agentDefault, MAX_HISTORY_BUDGET_TOKENS]`, then capped by any governance
 * limit. Monotonic vs. the old behaviour: never returns less than the agent
 * default unless governance explicitly caps lower.
 */
export function resolveContextBudget(input: ContextBudgetInput): number {
  const window = resolveWindow(input.contextWindow);
  const floor =
    input.agentDefault && input.agentDefault > 0
      ? input.agentDefault
      : DEFAULT_MAX_HISTORY_TOKENS;

  let budget = Math.round(window * HISTORY_WINDOW_UTILIZATION);
  budget = Math.min(budget, MAX_HISTORY_BUDGET_TOKENS);
  budget = Math.max(budget, floor);
  if (input.governanceMaxContext && input.governanceMaxContext > 0) {
    budget = Math.min(budget, input.governanceMaxContext);
  }
  return budget;
}

/**
 * Effective context window the assembled prompt must fit within: the model's
 * window (default fallback when unknown) capped by any governance limit. The
 * compaction trigger compares the REAL prompt input against
 * `COMPACTION_TRIGGER_RATIO` of THIS (i.e. "90% of the context window") — not
 * against the smaller history budget, which would fire far too early because
 * the prompt input also includes the system prompt, tools, and RAG/web context.
 */
export function resolveEffectiveContextWindow(input: {
  contextWindow?: number;
  governanceMaxContext?: number;
}): number {
  const window = resolveWindow(input.contextWindow);
  return input.governanceMaxContext && input.governanceMaxContext > 0
    ? Math.min(window, input.governanceMaxContext)
    : window;
}

/**
 * Whether the just-completed turn crossed the compaction threshold. Uses the
 * provider-reported prompt input tokens (the most accurate "how full is the
 * window" signal) against the effective context window. Returns false when
 * usage is unavailable.
 */
export function shouldCompact(
  inputTokens: number | undefined,
  budget: number,
): boolean {
  return (
    inputTokens != null &&
    Number.isFinite(inputTokens) &&
    inputTokens >= COMPACTION_TRIGGER_RATIO * budget
  );
}

/**
 * Split point for compaction. Given the per-message token sizes (chronological,
 * oldest→newest) and the keep-recent token budget, returns the index `idx` such
 * that messages `[0, idx)` are folded into the summary and `[idx, n)` are kept
 * verbatim. Walks newest→oldest accumulating tokens until the keep budget is
 * exceeded, so the most recent turns that fit are always preserved. Returns 0
 * when everything fits in the keep window (nothing to summarize).
 */
export function computeCompactionSplit(
  tokenSizes: number[],
  keepBudget: number,
): number {
  let recent = 0;
  for (let i = tokenSizes.length - 1; i >= 0; i--) {
    recent += tokenSizes[i];
    if (recent > keepBudget) return i + 1;
  }
  return 0;
}
