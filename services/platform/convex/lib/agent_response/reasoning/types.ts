/**
 * Shared types for the Adaptive Reasoning Governor.
 *
 * The governor decides, per generation, how hard a reasoning-capable model
 * should think — replacing the implicit "always at the provider default"
 * behaviour with a difficulty-scaled budget the model then self-regulates
 * within. See `build_reasoning_options.ts` for the orchestration and the
 * sibling layer modules (`signals`, `capability`, `controller`) for each
 * stage.
 */

/**
 * Canonical reasoning intensity. Provider-agnostic; the capability layer maps
 * a tier to whatever knob the concrete model exposes (effort string vs.
 * thinking-token budget). `'off'` means "do not ask the model to reason"
 * (emit nothing, or the provider's minimal floor for effort models).
 */
export type ReasoningTier = 'off' | 'low' | 'medium' | 'high';

/**
 * A resolved reasoning decision in canonical units. `budgetTokens` is the
 * thinking-token ceiling implied by the tier (0 for `'off'`); the capability
 * mapper caps it to the model's real limits before it reaches the wire.
 */
export interface ReasoningTarget {
  tier: ReasoningTier;
  budgetTokens: number;
}

/**
 * What kind of generation this is. Drives the Layer-A prior: `'utility'`
 * calls (title generation, field translation, message improvement) are
 * mechanical and always resolve to minimal reasoning, regardless of content.
 */
export type ReasoningKind = 'chat' | 'subagent' | 'utility';

/**
 * Coarse difficulty class a turn falls into. The controller keeps separate
 * learned statistics per class, so it estimates a difficulty→reasoning curve
 * rather than a single scalar.
 */
export type DifficultyClass = 'easy' | 'medium' | 'hard';

/**
 * Online statistics for one difficulty bucket. `mean`/`m2` are Welford
 * accumulators over observed reasoning tokens (so variance is available
 * without storing samples); `underResourcedEma` tracks how often the budget
 * looked insufficient (saturation / retry / length-finish).
 */
export interface BucketStats {
  count: number;
  mean: number;
  /** Welford sum of squared deviations; variance = m2 / (count - 1). */
  m2: number;
  /** EMA in [0,1] of the "budget was insufficient" indicator. */
  underResourcedEma: number;
  /**
   * EMA in [0,1] of the "reasoning was wasteful" indicator — the model burned
   * most of its thinking budget but produced a tiny answer with a clean finish
   * (thought hard, said little). Drives a downward nudge in `adjustTarget` so
   * the controller learns to stop over-reasoning a class. Optional because
   * persisted rows written before this field existed omit it; readers coalesce
   * to 0 (`emptyBucket` always sets it for freshly-created state).
   */
  wastefulEma?: number;
  /**
   * EMA in [0,1] of the response-QUALITY score for this class (from the shared
   * quality analyzer — hedging / specificity / hallucination / length). Lets
   * the controller see whether the budget actually produced GOOD answers, not
   * just how many tokens were spent: low quality on a saturating class is a
   * stronger "needs more reasoning" cue. Optional (legacy rows omit it; readers
   * coalesce to a neutral 1.0 = "no quality complaint yet").
   */
  qualityEma?: number;
  /**
   * The reasoning tier the controller last settled on for this class. Drives the
   * effort-tier bandit's anti-oscillation: a class hovering on a tier seam may
   * not flip back the other way on EMA noise unless the reversing signal clears
   * its deadband by a margin. Optional (legacy rows / pre-decision buckets omit
   * it; absence disables the guard, so behaviour matches the unsmoothed bandit).
   */
  lastTier?: ReasoningTier;
}

/**
 * Persisted per-thread learning state for the online controller (Layer C).
 * Compact by design — it rides on `threadMetadata` and is updated once per
 * completed turn from telemetry the platform already records. Per-class
 * buckets let the controller learn a difficulty→need curve; `turns` drives the
 * deterministic exploration schedule.
 */
export interface ReasoningState {
  easy: BucketStats;
  medium: BucketStats;
  hard: BucketStats;
  turns: number;
  /**
   * Cross-class Welford accumulators over the continuous difficulty intensity
   * (not per-class). Used to self-calibrate the easy/medium/hard thresholds to
   * an org's actual traffic distribution (`adaptiveDifficultyThresholds`).
   * Optional on legacy rows; readers fall back to the static thresholds.
   */
  intensityCount?: number;
  intensityMean?: number;
  intensityM2?: number;
}

function emptyBucket(): BucketStats {
  return {
    count: 0,
    mean: 0,
    m2: 0,
    underResourcedEma: 0,
    wastefulEma: 0,
    // Neutral start: 1.0 = "no quality complaint yet", so a fresh bucket never
    // looks under-performing until real low-quality turns pull it down.
    qualityEma: 1,
  };
}

export function emptyReasoningState(): ReasoningState {
  return {
    easy: emptyBucket(),
    medium: emptyBucket(),
    hard: emptyBucket(),
    turns: 0,
  };
}

/** Sample standard deviation for a bucket (0 when fewer than 2 samples). */
export function bucketStd(bucket: BucketStats): number {
  if (bucket.count < 2) return 0;
  return Math.sqrt(Math.max(0, bucket.m2 / (bucket.count - 1)));
}

/** Static easy↔medium / medium↔hard intensity boundaries. */
const DEFAULT_DIFFICULTY_THRESHOLDS = { lo: 0.34, hi: 0.67 } as const;

interface DifficultyThresholds {
  lo: number;
  hi: number;
}

/** Map a continuous intensity in [0,1] to a coarse difficulty class. Optional
 *  `thresholds` self-calibrate the boundaries to an org's traffic; omitted =
 *  the static defaults (so existing behaviour is byte-identical). */
export function classFromIntensity(
  intensity: number,
  thresholds: DifficultyThresholds = DEFAULT_DIFFICULTY_THRESHOLDS,
): DifficultyClass {
  if (intensity < thresholds.lo) return 'easy';
  if (intensity < thresholds.hi) return 'medium';
  return 'hard';
}

/**
 * Derive self-calibrated difficulty thresholds from a state's learned intensity
 * distribution. Returns the static defaults until there's enough evidence
 * (`MIN_SAMPLES`), then centers the bands on `mean ± 0.43·std` (the ~33/66
 * points of a normal) — hard-clamped so they can never invert or collapse onto
 * the static bands' safe envelope.
 */
const ADAPTIVE_THRESHOLD_MIN_SAMPLES = 20;
export function adaptiveDifficultyThresholds(
  state: ReasoningState | undefined,
): DifficultyThresholds {
  const n = state?.intensityCount ?? 0;
  if (!state || n < ADAPTIVE_THRESHOLD_MIN_SAMPLES) {
    return DEFAULT_DIFFICULTY_THRESHOLDS;
  }
  const mean = state.intensityMean ?? 0.5;
  const variance = n >= 2 ? Math.max(0, (state.intensityM2 ?? 0) / (n - 1)) : 0;
  const std = Math.sqrt(variance);
  const lo = Math.min(0.45, Math.max(0.2, mean - 0.43 * std));
  const hi = Math.max(0.55, Math.min(0.8, mean + 0.43 * std));
  return { lo, hi };
}

/** Canonical thinking-token budget implied by each tier. */
export const TIER_BUDGET_TOKENS: Record<ReasoningTier, number> = {
  off: 0,
  low: 2048,
  medium: 8192,
  high: 24576,
};

/** Rank used to take the max of two tiers (floor enforcement). */
export const TIER_RANK: Record<ReasoningTier, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const RANK_TIER: ReasoningTier[] = ['off', 'low', 'medium', 'high'];

/** The higher (more reasoning) of two tiers. */
export function maxTier(a: ReasoningTier, b: ReasoningTier): ReasoningTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

/** The lower (less reasoning) of two tiers — used for ceiling enforcement. */
export function minTier(a: ReasoningTier, b: ReasoningTier): ReasoningTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

/**
 * Bucket a raw thinking-token budget to a canonical tier. The boundaries sit
 * deliberately *below* the midpoints between canonical budgets so a budget
 * biases toward the higher tier (e.g. a "hard" prompt landing near the
 * medium↔high seam still resolves to `high`) — under-reasoning a hard task is
 * worse than spending a few extra tokens. Not a nearest-neighbour mapping.
 */
export function budgetToTier(budgetTokens: number): ReasoningTier {
  if (budgetTokens <= 0) return 'off';
  if (budgetTokens <= 3072) return 'low';
  if (budgetTokens <= 12288) return 'medium';
  return 'high';
}

/** Map a rank index (0–3) back to its tier; clamps out-of-range input. */
export function tierFromRank(rank: number): ReasoningTier {
  const clamped = Math.max(0, Math.min(RANK_TIER.length - 1, Math.round(rank)));
  return RANK_TIER[clamped];
}
