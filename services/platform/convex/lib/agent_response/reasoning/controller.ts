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
import { clamp01 } from './clamp';
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
// The under/waste deadbands live in QUALITY_DEADBANDS (keyed by qualityProfile);
// the `balanced` preset reproduces the original HI=0.5 / LO=0.2 / WASTE=0.5.
// Multiplicative bump when a self-truncating model looks under-resourced.
const BUMP_FACTOR = 1.4;
// effUnder ≥ this ⇒ the class is strongly starved; on tier-filling models, jump
// two tiers at once instead of one (converge faster at the edge). Profile-
// independent so a pathologically starved class always converges fast.
const UNDER_RESOURCED_STRONG = 0.8;
// Multiplicative trim applied to a self-truncating estimate when wasteful.
const WASTE_TRIM = 0.85;
// Samples required before a tier-filling bucket may take the fast (−2) trim.
const MIN_N_TO_TRIM_FAST = 4;
// A turn is "wasteful" when it spent ≥ this fraction of its thinking budget …
const WASTE_BUDGET_FRACTION = 0.6;
// … yet produced fewer than this many output tokens (a clean, terse finish).
const WASTE_OUTPUT_FLOOR = 256;
// The controller may not exceed this multiple of the per-turn prior.
const BAND_MAX = 1.5;
// Samples required before the controller trusts usage to estimate a budget. Two
// (not one) so a single noisy reasoning-token reading can't swing the estimate;
// the org-wide profile warm-start already covers a fresh thread in a known org.
const MIN_SAMPLES_TO_TRUST = 2;
// Samples required before an effort-tier bucket may be trimmed below the prior.
const MIN_N_TO_TRIM = 2;
// Anti-oscillation: a reversing tier move must clear its deadband by this margin
// before it may flip the tier the controller last settled on (see adjustTarget).
const HYSTERESIS_MARGIN = 0.15;
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
  /** Finish reason; `'length'` means the OUTPUT hit its cap (not the thinking
   * budget — those are distinct signals; see `recordOutcome`). */
  finishReason?: string;
  /** Whether the turn needed a continue/retry — a strong under-resourced cue. */
  retried?: boolean;
  /** Observed output (answer) tokens; used to detect wasteful over-reasoning. */
  outputTokens?: number;
  /** This turn's continuous difficulty intensity [0,1]; folded into the state's
   *  intensity distribution to self-calibrate the difficulty thresholds. */
  intensity?: number;
  /**
   * This turn's response-quality score in [0,1] (from the shared quality
   * analyzer). Folded into the per-class `qualityEma`. Omit when not scored
   * (e.g. tool-only turns) — the EMA simply isn't updated.
   */
  qualityScore?: number;
  /**
   * The reasoning tier the controller settled on for this turn. Persisted to the
   * bucket's `lastTier` to drive the effort-tier anti-oscillation guard next
   * turn. Omit when unknown — the prior `lastTier` is then preserved.
   */
  chosenTier?: ReasoningTier;
}

/**
 * Quality-feedback tuning preset for the controller deadbands. The governor
 * always runs `balanced` now (the manual per-agent `qualityProfile` override was
 * removed); `strict`/`lenient` are retained as the preset vocabulary for the
 * deadband table and tests. `balanced` is `adjustTarget`'s default.
 */
export type QualityProfile = 'lenient' | 'balanced' | 'strict';

interface QualityDeadbands {
  underHi: number;
  underLo: number;
  wasteHi: number;
  /** Quality EMA at/above which the class is "good enough"; below pulls the
   *  effective under-resourced signal up (more reasoning). */
  qualityTarget: number;
}

const QUALITY_DEADBANDS: Record<QualityProfile, QualityDeadbands> = {
  // balanced === the original constants (UNDER_RESOURCED_HI/LO, WASTE_HI).
  balanced: { underHi: 0.5, underLo: 0.2, wasteHi: 0.5, qualityTarget: 0.7 },
  strict: { underHi: 0.4, underLo: 0.15, wasteHi: 0.6, qualityTarget: 0.8 },
  lenient: { underHi: 0.6, underLo: 0.25, wasteHi: 0.4, qualityTarget: 0.6 },
};

// How strongly a quality shortfall lifts the effective under-resourced signal.
const QUALITY_UNDER_WEIGHT = 0.5;
// Quality-shortfall fraction at/above which a self-truncating class with NO
// usage samples (e.g. parked at `off`/`low`, so it never produced thinking
// tokens) is nudged up one tier — so the model gets to think and reveal its real
// need instead of being deadlocked by a too-low prior. Conservative: only fires
// on a clear, sustained quality complaint (qualityEma well below the target).
const QUALITY_COLD_BUMP = 0.25;

function welfordUpdate(b: BucketStats, x: number): BucketStats {
  const count = b.count + 1;
  const delta = x - b.mean;
  const mean = b.mean + delta / count;
  const m2 = b.m2 + delta * (x - mean);
  return { ...b, count, mean, m2 };
}

/** Exponential moving average step (alpha = SATURATION_ALPHA). */
function ema(prev: number, observation: number): number {
  return SATURATION_ALPHA * observation + (1 - SATURATION_ALPHA) * prev;
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
  // A `'length'` finish means the OUTPUT hit max_tokens — a generation-length
  // problem, NOT a thinking-budget problem. Bumping the thinking budget on it
  // wastes tokens, so it is deliberately excluded here; genuine thinking
  // starvation on a self-truncating model is already captured by saturation,
  // and a continue/retry is the cross-knob "needed more" cue.
  const underResourced =
    outcome.retried === true ||
    (outcome.selfTruncates && saturation >= SATURATION_THRESHOLD);
  const underResourcedEma = ema(
    bucket.underResourcedEma ?? 0,
    underResourced ? 1 : 0,
  );

  // Wasteful: thought hard (≥60% of budget) but answered tersely with a clean
  // finish and no retry — a strong "this class is over-resourced" signal.
  const out = outcome.outputTokens;
  const hasOut = out != null && Number.isFinite(out) && out >= 0;
  const wasteful =
    hasTokens &&
    hasOut &&
    outcome.budgetTokens > 0 &&
    tokens >= WASTE_BUDGET_FRACTION * outcome.budgetTokens &&
    out < WASTE_OUTPUT_FLOOR &&
    outcome.finishReason === 'stop' &&
    outcome.retried !== true;
  const wastefulEma = ema(bucket.wastefulEma ?? 0, wasteful ? 1 : 0);

  // Quality EMA — only updated on turns where a quality score was computed.
  const q = outcome.qualityScore;
  const hasQuality = q != null && Number.isFinite(q);
  const priorQualityEma = bucket.qualityEma ?? 1;
  const qualityEma = hasQuality
    ? ema(priorQualityEma, clamp01(q))
    : priorQualityEma;

  // Remember the tier we settled on (anti-oscillation guard); preserve the
  // prior when this turn didn't report one (e.g. a non-steerable / tool turn).
  const lastTier = outcome.chosenTier ?? bucket.lastTier;
  bucket = { ...bucket, underResourcedEma, wastefulEma, qualityEma, lastTier };

  // Cross-class Welford over the difficulty intensity (self-calibration input).
  let { intensityCount, intensityMean, intensityM2 } = base;
  const intensity = outcome.intensity;
  if (intensity != null && Number.isFinite(intensity)) {
    const n = (intensityCount ?? 0) + 1;
    const prevMean = intensityMean ?? 0;
    const mean = prevMean + (intensity - prevMean) / n;
    const m2 = (intensityM2 ?? 0) + (intensity - prevMean) * (intensity - mean);
    intensityCount = n;
    intensityMean = mean;
    intensityM2 = m2;
  }

  return {
    ...base,
    [cls]: bucket,
    turns: base.turns + 1,
    intensityCount,
    intensityMean,
    intensityM2,
  };
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
  /** Wasteful-reasoning EMA from the level with evidence (thread preferred). */
  wastefulEma: number;
  /** Response-quality EMA from the level with evidence (thread preferred). */
  qualityEma: number;
  /** Last settled tier from the level with evidence (anti-oscillation guard). */
  lastTier?: ReasoningTier;
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
    ? (threadBucket.underResourcedEma ?? 0)
    : (profileBucket?.underResourcedEma ?? 0);
  const wastefulEma = threadBucket
    ? (threadBucket.wastefulEma ?? 0)
    : (profileBucket?.wastefulEma ?? 0);
  const qualityEma = threadBucket
    ? (threadBucket.qualityEma ?? 1)
    : (profileBucket?.qualityEma ?? 1);
  // Prefer the thread's own settled tier; fall back to the inherited profile
  // when the thread bucket exists but hasn't recorded a tier yet (mirrors the
  // `?? default` coalescing the sibling EMAs above use).
  const lastTier = threadBucket?.lastTier ?? profileBucket?.lastTier;
  return {
    mean,
    std,
    count: dataN,
    underResourcedEma,
    wastefulEma,
    qualityEma,
    lastTier,
  };
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
  qualityProfile: QualityProfile = 'balanced',
): ReasoningTarget {
  const floorBudget = TIER_BUDGET_TOKENS[floorTier];
  const priorBudget = prior.budgetTokens;
  const db = QUALITY_DEADBANDS[qualityProfile];

  const view = combineBuckets(
    state?.[difficultyClass],
    profile?.[difficultyClass],
    priorBudget,
  );

  // Quality-sharpened under-resourced signal: a class whose recent answers
  // scored BELOW the profile's quality target is treated as more starved than
  // tokens alone suggest (low quality + saturation ⇒ likely needs more
  // reasoning). With a neutral qualityEma (1.0) the penalty is 0, so behaviour
  // is identical to the token-only controller.
  const qualityShortfall = Math.max(
    0,
    (db.qualityTarget - view.qualityEma) / db.qualityTarget,
  );
  const effUnder = Math.min(
    1,
    view.underResourcedEma + QUALITY_UNDER_WEIGHT * qualityShortfall,
  );

  if (capability.selfTruncates) {
    // Not enough token samples to estimate the budget from usage yet. Trust the
    // (floored) prior — UNLESS the class has been answering poorly with no way
    // to learn: a self-truncating model parked at a low tier never produces
    // thinking-token samples, so without this nudge a genuinely-underpowered
    // class could stay deadlocked. A clear, sustained quality shortfall bumps it
    // one tier so the model gets to think and reveal its real need next turn.
    if (view.count < MIN_SAMPLES_TO_TRUST) {
      if (
        qualityShortfall >= QUALITY_COLD_BUMP &&
        TIER_RANK[prior.tier] < TIER_RANK.high
      ) {
        const bumped = maxTier(
          tierFromRank(TIER_RANK[prior.tier] + 1),
          floorTier,
        );
        return { tier: bumped, budgetTokens: TIER_BUDGET_TOKENS[bumped] };
      }
      return clampToFloor(prior, floorTier, floorBudget);
    }
    // Usage reveals the true need: estimate it plus an uncertainty headroom,
    // then bump if recent turns looked clipped / low-quality — or trim if the
    // class is confidently wasteful (thought hard, answered tersely). Bump
    // dominates a trim; the clamp keeps it within [floor, prior·band].
    let estimate = view.mean * SELF_TRUNC_MARGIN + K_SIGMA * view.std;
    if (effUnder >= db.underHi) estimate *= BUMP_FACTOR;
    else if (view.wastefulEma >= db.wasteHi) estimate *= WASTE_TRIM;
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
  if (effUnder >= UNDER_RESOURCED_STRONG) {
    // Strongly starved: skip a tier so a badly-under-provisioned class
    // converges in one step instead of crawling up by one per turn.
    rank += 2;
  } else if (effUnder >= db.underHi) {
    rank += 1;
  } else if (
    view.wastefulEma >= db.wasteHi &&
    view.count >= MIN_N_TO_TRIM_FAST
  ) {
    // Confidently wasteful with enough evidence: trim two tiers at once.
    rank -= 2;
  } else if (effUnder < db.underLo && view.count >= MIN_N_TO_TRIM) {
    rank -= 1;
  }
  rank = Math.max(TIER_RANK[floorTier], Math.min(rank, TIER_RANK.high));
  let tier = maxTier(tierFromRank(rank), floorTier);

  // Anti-oscillation: once the class has settled on a tier, don't flip back the
  // other way on a marginal signal — a class hovering on a seam would otherwise
  // wobble every turn (the reason someone reached for a manual effort floor).
  // Hold at the last tier unless the reversing signal clears its deadband by
  // HYSTERESIS_MARGIN. Never holds below the floor; strong starvation (effUnder
  // ≥ UNDER_RESOURCED_STRONG) always escalates, so a starved class still jumps.
  const lastTier = view.lastTier;
  if (
    lastTier &&
    lastTier !== tier &&
    TIER_RANK[lastTier] >= TIER_RANK[floorTier]
  ) {
    const movingUp = TIER_RANK[tier] > TIER_RANK[lastTier];
    const decisive = movingUp
      ? effUnder >= UNDER_RESOURCED_STRONG ||
        effUnder >= db.underHi + HYSTERESIS_MARGIN
      : effUnder < db.underLo - HYSTERESIS_MARGIN ||
        view.wastefulEma >= db.wasteHi + HYSTERESIS_MARGIN;
    if (!decisive) tier = lastTier;
  }
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
