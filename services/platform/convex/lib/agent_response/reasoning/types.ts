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

export const DIFFICULTY_CLASSES: readonly DifficultyClass[] = [
  'easy',
  'medium',
  'hard',
];

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
}

export function emptyBucket(): BucketStats {
  return { count: 0, mean: 0, m2: 0, underResourcedEma: 0 };
}

export function emptyReasoningState(): ReasoningState {
  return {
    easy: emptyBucket(),
    medium: emptyBucket(),
    hard: emptyBucket(),
    turns: 0,
  };
}

/** Population variance estimate for a bucket (0 when fewer than 2 samples). */
export function bucketStd(bucket: BucketStats): number {
  if (bucket.count < 2) return 0;
  return Math.sqrt(Math.max(0, bucket.m2 / (bucket.count - 1)));
}

/** Map a continuous intensity in [0,1] to a coarse difficulty class. */
export function classFromIntensity(intensity: number): DifficultyClass {
  if (intensity < 0.34) return 'easy';
  if (intensity < 0.67) return 'medium';
  return 'hard';
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

/** Bucket a raw thinking-token budget back to the nearest canonical tier. */
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
