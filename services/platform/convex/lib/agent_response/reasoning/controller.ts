/**
 * Layer C — the online feedback controller (the novel core).
 *
 * Instead of guessing a fixed reasoning level, the controller reads how much
 * the model *actually* reasoned on prior turns (the `reasoningTokens` usage the
 * platform already records) and converges the budget toward the model's
 * revealed need — per thread, per difficulty class, with no extra inference
 * calls and therefore no added latency.
 *
 * Two ideas make this much sharper than a single moving average:
 *
 *  1. **The feedback signal's meaning depends on the knob.** A self-truncating
 *     model (Anthropic-style thinking) stops on its own, so its usage *reveals*
 *     its need — we estimate it directly (shrunk toward a prior, plus an
 *     uncertainty headroom from the running variance). A tier-filling model
 *     (OpenAI effort) consumes whatever tier it's given, so usage is
 *     uninformative about the *minimum*; there we run a damped up/down bandit
 *     on the tier, driven by whether turns came back under-resourced.
 *
 *  2. **Per-difficulty-class learning.** Stats are kept per class (easy /
 *     medium / hard) with hierarchical shrinkage toward the thread-global mean
 *     and the static prior, so sparse buckets borrow strength and the system
 *     learns a difficulty→need *curve*, not one number.
 *
 * The controller never undercuts the current turn's hard floor (Layer A) and
 * degrades to the prior when telemetry is unavailable.
 */

import type { ReasoningCapability } from './capability';
import {
  bucketStd,
  budgetToTier,
  emptyReasoningState,
  maxTier,
  TIER_BUDGET_TOKENS,
  TIER_RANK,
  tierFromRank,
  type BucketStats,
  type DifficultyClass,
  type ReasoningState,
  type ReasoningTarget,
  type ReasoningTier,
} from './types';

// EMA weight for the under-resourced indicator.
const SATURATION_ALPHA = 0.5;
// usage / budget ≥ this on a self-truncating model ⇒ it likely wanted more.
const SATURATION_THRESHOLD = 0.9;
// Pseudo-count pulling sparse buckets toward the prior/global anchor.
const SHRINK_PSEUDO = 3;
// Uncertainty headroom added to the estimate (mean + k · std).
const K_SIGMA = 1.0;
// Safety multiplier over revealed need for self-truncating models.
const SELF_TRUNC_MARGIN = 1.15;
// underResourcedEma ≥ HI ⇒ bump up; < LO ⇒ confident enough to trim down.
// The gap between them is a hysteresis deadband that prevents oscillation.
const UNDER_RESOURCED_HI = 0.5;
const UNDER_RESOURCED_LO = 0.2;
// Multiplicative bump when a self-truncating model looks under-resourced.
const BUMP_FACTOR = 1.4;
// The controller may not exceed this multiple of the per-turn prior.
const BAND_MAX = 1.5;
// Samples required before the controller adjusts a bucket at all.
const MIN_SAMPLES_TO_TRUST = 1;
// Samples required before an effort-tier bucket may be trimmed below the prior.
const MIN_N_TO_TRIM = 2;
// Cap on how much a cross-thread profile counts as evidence, so a thread's own
// observations eventually dominate its inherited (org/model) warm start.
const PROFILE_SAMPLE_CAP = 20;

export interface ReasoningOutcome {
  difficultyClass: DifficultyClass;
  /** Observed reasoning tokens; omit when the provider didn't report them. */
  reasoningTokens?: number;
  /** The thinking-token budget we set this turn (0 for effort-tier models). */
  budgetTokens: number;
  /** Whether the model self-truncates (budget knob) — see capability. */
  selfTruncates: boolean;
  /** Finish reason; `'length'` means the answer hit the output cap. */
  finishReason?: string;
  /** Whether the turn needed a continue/retry — a strong under-resourced cue. */
  retried?: boolean;
}

function welfordUpdate(b: BucketStats, x: number): BucketStats {
  const count = b.count + 1;
  const delta = x - b.mean;
  const mean = b.mean + delta / count;
  const m2 = b.m2 + delta * (x - mean);
  return { ...b, count, mean, m2 };
}

/**
 * Fold a completed turn into the per-thread state. Pure; returns a new object.
 * Records observed reasoning tokens (Welford) and an "under-resourced" EMA
 * derived from saturation / retry / length-finish.
 */
export function recordOutcome(
  state: ReasoningState | undefined,
  outcome: ReasoningOutcome,
): ReasoningState {
  const base = state ?? emptyReasoningState();
  const cls = outcome.difficultyClass;
  let bucket = base[cls];

  const tokens = outcome.reasoningTokens;
  const hasTokens = tokens != null && Number.isFinite(tokens) && tokens >= 0;
  if (hasTokens) bucket = welfordUpdate(bucket, tokens);

  const saturation =
    outcome.budgetTokens > 0 && hasTokens ? tokens / outcome.budgetTokens : 0;
  const underResourced =
    outcome.retried === true ||
    outcome.finishReason === 'length' ||
    (outcome.selfTruncates && saturation >= SATURATION_THRESHOLD);
  const underResourcedEma =
    SATURATION_ALPHA * (underResourced ? 1 : 0) +
    (1 - SATURATION_ALPHA) * bucket.underResourcedEma;
  bucket = { ...bucket, underResourcedEma };

  return { ...base, [cls]: bucket, turns: base.turns + 1 };
}

function clampBudget(
  value: number,
  floorBudget: number,
  priorBudget: number,
): number {
  const ceiling = Math.max(priorBudget * BAND_MAX, floorBudget);
  return Math.max(floorBudget, Math.min(value, ceiling));
}

interface CombinedView {
  /** Prior-shrunk, precision-weighted estimate of reasoning need (tokens). */
  mean: number;
  /** Std from the level with the most evidence (thread preferred). */
  std: number;
  /** Effective evidence count (thread + capped profile). */
  count: number;
  /** Under-resourced EMA from the level with evidence (thread preferred). */
  underResourcedEma: number;
}

/**
 * Hierarchical empirical-Bayes view of a difficulty class: blend the thread's
 * own observations with the inherited (org/model) profile — the profile's
 * weight capped so a thread's own evidence eventually dominates — then shrink
 * the blend toward the static prior. A fresh thread with a warm profile gets a
 * useful estimate from turn one; a thread with its own history trusts itself.
 */
function combineBuckets(
  threadBucket: BucketStats | undefined,
  profileBucket: BucketStats | undefined,
  priorBudget: number,
): CombinedView {
  const tN = threadBucket?.count ?? 0;
  const pN = Math.min(profileBucket?.count ?? 0, PROFILE_SAMPLE_CAP);
  const dataN = tN + pN;
  const blended =
    dataN === 0
      ? priorBudget
      : (tN * (threadBucket?.mean ?? 0) + pN * (profileBucket?.mean ?? 0)) /
        dataN;
  const mean =
    dataN === 0
      ? priorBudget
      : (dataN * blended + SHRINK_PSEUDO * priorBudget) /
        (dataN + SHRINK_PSEUDO);
  const std =
    threadBucket && tN >= 2
      ? bucketStd(threadBucket)
      : profileBucket && profileBucket.count >= 2
        ? bucketStd(profileBucket)
        : 0;
  // The under-resourced signal updates every turn (even when no reasoning
  // tokens are reported), so it is independent of the Welford sample count.
  // Prefer the thread's own signal; fall back to the inherited profile.
  const underResourcedEma = threadBucket
    ? threadBucket.underResourcedEma
    : (profileBucket?.underResourcedEma ?? 0);
  return { mean, std, count: dataN, underResourcedEma };
}

/**
 * Blend the Layer-A prior with the controller's learned estimate (thread +
 * inherited profile) and re-bucket to a tier — knob-aware. Clamped below by the
 * floor (a hard turn is never starved) and above by a band over the prior (no
 * runaway escalation).
 */
export function adjustTarget(
  prior: ReasoningTarget,
  floorTier: ReasoningTier,
  difficultyClass: DifficultyClass,
  state: ReasoningState | undefined,
  capability: ReasoningCapability,
  profile?: ReasoningState,
): ReasoningTarget {
  const floorBudget = TIER_BUDGET_TOKENS[floorTier];
  const priorBudget = prior.budgetTokens;

  const view = combineBuckets(
    state?.[difficultyClass],
    profile?.[difficultyClass],
    priorBudget,
  );

  if (capability.selfTruncates) {
    // Need at least one token sample to estimate the budget from usage;
    // otherwise trust the prior (floored).
    if (view.count < MIN_SAMPLES_TO_TRUST) {
      return clampToFloor(prior, floorTier, floorBudget);
    }
    // Usage reveals the true need: estimate it plus an uncertainty headroom,
    // then bump if recent turns looked clipped.
    let estimate = view.mean * SELF_TRUNC_MARGIN + K_SIGMA * view.std;
    if (view.underResourcedEma >= UNDER_RESOURCED_HI) estimate *= BUMP_FACTOR;
    const bounded = clampBudget(estimate, floorBudget, priorBudget);
    return {
      tier: maxTier(budgetToTier(bounded), floorTier),
      budgetTokens: Math.round(bounded),
    };
  }

  // Tier-filling (effort) models: usage saturates and can't reveal the minimum,
  // so we run a damped one-step bandit on the tier. Bump up when turns come
  // back under-resourced; trim one tier when the class is confidently fine. The
  // HI/LO deadband + the ±1-tier bound around the prior keep it from
  // oscillating or drifting away from the difficulty signal.
  let rank = TIER_RANK[prior.tier];
  if (view.underResourcedEma >= UNDER_RESOURCED_HI) {
    rank += 1;
  } else if (
    view.underResourcedEma < UNDER_RESOURCED_LO &&
    view.count >= MIN_N_TO_TRIM
  ) {
    rank -= 1;
  }
  rank = Math.max(TIER_RANK[floorTier], Math.min(rank, TIER_RANK.high));
  const tier = maxTier(tierFromRank(rank), floorTier);
  return { tier, budgetTokens: TIER_BUDGET_TOKENS[tier] };
}

function clampToFloor(
  target: ReasoningTarget,
  floorTier: ReasoningTier,
  floorBudget: number,
): ReasoningTarget {
  if (TIER_RANK[target.tier] >= TIER_RANK[floorTier]) return target;
  return {
    tier: floorTier,
    budgetTokens: Math.max(target.budgetTokens, floorBudget),
  };
}
