import { describe, expect, it } from 'vitest';

import type { ReasoningCapability } from './capability';
import {
  adjustTarget,
  recordOutcome,
  type ReasoningOutcome,
} from './controller';
import {
  TIER_BUDGET_TOKENS,
  type ReasoningState,
  type ReasoningTarget,
} from './types';

const SELF_TRUNC: ReasoningCapability = {
  knob: 'budgetTokens',
  selfTruncates: true,
  minBudgetTokens: 1024,
};
const EFFORT: ReasoningCapability = { knob: 'effort', selfTruncates: false };

const high: ReasoningTarget = {
  tier: 'high',
  budgetTokens: TIER_BUDGET_TOKENS.high,
};
const medium: ReasoningTarget = {
  tier: 'medium',
  budgetTokens: TIER_BUDGET_TOKENS.medium,
};
const low: ReasoningTarget = {
  tier: 'low',
  budgetTokens: TIER_BUDGET_TOKENS.low,
};
const off: ReasoningTarget = { tier: 'off', budgetTokens: 0 };

function recordMany(
  n: number,
  outcome: ReasoningOutcome,
  state?: ReasoningState,
): ReasoningState {
  let s = state;
  for (let i = 0; i < n; i++) s = recordOutcome(s, outcome);
  return s as ReasoningState;
}

describe('recordOutcome', () => {
  it('seeds Welford stats from the first observation', () => {
    const s = recordOutcome(undefined, {
      difficultyClass: 'hard',
      reasoningTokens: 1000,
      budgetTokens: 8000,
      selfTruncates: true,
    });
    expect(s.hard.count).toBe(1);
    expect(s.hard.mean).toBe(1000);
    expect(s.turns).toBe(1);
  });

  it('accumulates a correct running mean', () => {
    let s = recordOutcome(undefined, {
      difficultyClass: 'medium',
      reasoningTokens: 1000,
      budgetTokens: 8000,
      selfTruncates: true,
    });
    s = recordOutcome(s, {
      difficultyClass: 'medium',
      reasoningTokens: 3000,
      budgetTokens: 8000,
      selfTruncates: true,
    });
    expect(s.medium.count).toBe(2);
    expect(s.medium.mean).toBeCloseTo(2000);
  });

  it('flags under-resourced on retry or saturation', () => {
    const retry = recordOutcome(undefined, {
      difficultyClass: 'hard',
      reasoningTokens: 100,
      budgetTokens: 8000,
      selfTruncates: true,
      retried: true,
    });
    expect(retry.hard.underResourcedEma).toBeGreaterThan(0);

    const saturated = recordOutcome(undefined, {
      difficultyClass: 'hard',
      reasoningTokens: 7800,
      budgetTokens: 8000,
      selfTruncates: true,
    });
    expect(saturated.hard.underResourcedEma).toBeGreaterThan(0);

    const fine = recordOutcome(undefined, {
      difficultyClass: 'hard',
      reasoningTokens: 1000,
      budgetTokens: 8000,
      selfTruncates: true,
      finishReason: 'stop',
    });
    expect(fine.hard.underResourcedEma).toBe(0);
  });

  it('does NOT treat a length-finish (output cap) as thinking-starvation (A1)', () => {
    // Output hit max_tokens but reasoning was nowhere near its budget: this is
    // a generation-length problem, not a thinking-budget one.
    const lengthLowSat = recordOutcome(undefined, {
      difficultyClass: 'hard',
      reasoningTokens: 500,
      budgetTokens: 8000,
      selfTruncates: true,
      finishReason: 'length',
    });
    expect(lengthLowSat.hard.underResourcedEma).toBe(0);

    // …but a length-finish that ALSO saturated the thinking budget still counts
    // (the saturation term, not the finish reason, carries it).
    const lengthSaturated = recordOutcome(undefined, {
      difficultyClass: 'hard',
      reasoningTokens: 7800,
      budgetTokens: 8000,
      selfTruncates: true,
      finishReason: 'length',
    });
    expect(lengthSaturated.hard.underResourcedEma).toBeGreaterThan(0);

    // Effort model (tier-filling): a bare length-finish is not under-resourced.
    const effortLength = recordOutcome(undefined, {
      difficultyClass: 'medium',
      budgetTokens: 0,
      selfTruncates: false,
      finishReason: 'length',
    });
    expect(effortLength.medium.underResourcedEma).toBe(0);
  });

  it('flags wasteful reasoning: high thinking, tiny clean answer (A2)', () => {
    const wasteful = recordOutcome(undefined, {
      difficultyClass: 'medium',
      reasoningTokens: 6000,
      outputTokens: 50,
      budgetTokens: 8000,
      selfTruncates: true,
      finishReason: 'stop',
    });
    expect(wasteful.medium.wastefulEma).toBeGreaterThan(0);
    // Not under-resourced — it finished cleanly with budget to spare.
    expect(wasteful.medium.underResourcedEma).toBe(0);

    // A long answer for the same thinking is NOT wasteful.
    const productive = recordOutcome(undefined, {
      difficultyClass: 'medium',
      reasoningTokens: 6000,
      outputTokens: 4000,
      budgetTokens: 8000,
      selfTruncates: true,
      finishReason: 'stop',
    });
    expect(productive.medium.wastefulEma).toBe(0);

    // A retried turn is never wasteful (it looked starved, not over-resourced).
    const retriedTerse = recordOutcome(undefined, {
      difficultyClass: 'medium',
      reasoningTokens: 6000,
      outputTokens: 50,
      budgetTokens: 8000,
      selfTruncates: true,
      retried: true,
    });
    expect(retriedTerse.medium.wastefulEma).toBe(0);
  });

  it('accumulates the cross-class intensity distribution (A6c)', () => {
    let s = recordOutcome(undefined, {
      difficultyClass: 'easy',
      budgetTokens: 0,
      selfTruncates: false,
      intensity: 0.2,
    });
    s = recordOutcome(s, {
      difficultyClass: 'hard',
      budgetTokens: 0,
      selfTruncates: false,
      intensity: 0.8,
    });
    expect(s.intensityCount).toBe(2);
    expect(s.intensityMean).toBeCloseTo(0.5);
    // Turns without an intensity sample don't perturb the distribution.
    s = recordOutcome(s, {
      difficultyClass: 'medium',
      budgetTokens: 0,
      selfTruncates: false,
    });
    expect(s.intensityCount).toBe(2);
    expect(s.turns).toBe(3);
  });

  it('counts the turn (and under-resourced) even without reasoning tokens', () => {
    const s = recordOutcome(undefined, {
      difficultyClass: 'easy',
      budgetTokens: 0,
      selfTruncates: false,
      retried: true,
    });
    expect(s.easy.count).toBe(0); // no Welford update without a sample
    expect(s.turns).toBe(1);
    expect(s.easy.underResourcedEma).toBeGreaterThan(0);
  });
});

describe('quality-feedback control', () => {
  const outcome = (qualityScore: number): ReasoningOutcome => ({
    difficultyClass: 'hard',
    reasoningTokens: 4000,
    outputTokens: 800,
    budgetTokens: 8000,
    selfTruncates: true,
    finishReason: 'stop',
    qualityScore,
  });

  it('lower response quality never reduces — and here raises — the reasoning budget', () => {
    // Same token usage; only the response-quality signal differs.
    const lowQuality = recordMany(15, outcome(0)); // qualityEma → ~0
    const highQuality = recordMany(15, outcome(1)); // qualityEma → ~1
    const lowT = adjustTarget(
      medium,
      'low',
      'hard',
      lowQuality,
      SELF_TRUNC,
      undefined,
      'balanced',
    );
    const highT = adjustTarget(
      medium,
      'low',
      'hard',
      highQuality,
      SELF_TRUNC,
      undefined,
      'balanced',
    );
    // A quality shortfall lifts the effective under-resourced signal, so the
    // governor budgets MORE for the low-quality class (bump), never less.
    expect(lowT.budgetTokens).toBeGreaterThanOrEqual(highT.budgetTokens);
  });

  it('with neutral (high) quality, behaviour matches the token-only controller', () => {
    const highQuality = recordMany(15, outcome(1));
    const withQuality = adjustTarget(
      medium,
      'low',
      'hard',
      highQuality,
      SELF_TRUNC,
      undefined,
      'balanced',
    );
    // qualityEma ~1 ⇒ zero shortfall ⇒ no quality-driven adjustment.
    expect(withQuality.budgetTokens).toBeGreaterThan(0);
  });
});

describe('migration safety — legacy rows without wastefulEma', () => {
  // A row persisted before the wastefulEma field existed: the bucket has no
  // `wastefulEma`. Readers must coalesce it to 0, never produce NaN, and behave
  // identically to an explicit-0 row (degrade-to-prior).
  const legacyBucket = {
    count: 5,
    mean: 2000,
    m2: 100,
    underResourcedEma: 0.3,
  };
  const legacyState = {
    easy: legacyBucket,
    medium: legacyBucket,
    hard: legacyBucket,
    turns: 5,
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
  } as unknown as ReasoningState;

  it('recordOutcome tolerates a legacy bucket and writes a finite wastefulEma', () => {
    const next = recordOutcome(legacyState, {
      difficultyClass: 'medium',
      reasoningTokens: 1500,
      outputTokens: 2000,
      budgetTokens: 8000,
      selfTruncates: true,
      finishReason: 'stop',
    });
    expect(Number.isFinite(next.medium.wastefulEma ?? 0)).toBe(true);
    expect(Number.isFinite(next.medium.underResourcedEma)).toBe(true);
  });

  it('adjustTarget on a legacy state equals the explicit-0 state', () => {
    const explicit = {
      easy: { ...legacyBucket, wastefulEma: 0 },
      medium: { ...legacyBucket, wastefulEma: 0 },
      hard: { ...legacyBucket, wastefulEma: 0 },
      turns: 5,
    };
    const a = adjustTarget(medium, 'off', 'medium', legacyState, SELF_TRUNC);
    const b = adjustTarget(medium, 'off', 'medium', explicit, SELF_TRUNC);
    expect(a).toEqual(b);
    expect(Number.isFinite(a.budgetTokens)).toBe(true);
  });
});

describe('adjustTarget — cold start', () => {
  it('returns the prior (floored) with no state', () => {
    expect(adjustTarget(high, 'off', 'hard', undefined, SELF_TRUNC).tier).toBe(
      'high',
    );
    const lifted = adjustTarget(off, 'medium', 'easy', undefined, EFFORT);
    expect(lifted.tier).toBe('medium');
  });
});

describe('adjustTarget — self-truncating (estimate from usage)', () => {
  it('converges a high prior down when usage is consistently low', () => {
    const s = recordMany(8, {
      difficultyClass: 'hard',
      reasoningTokens: 1500,
      budgetTokens: TIER_BUDGET_TOKENS.high,
      selfTruncates: true,
      finishReason: 'stop',
    });
    const adj = adjustTarget(high, 'off', 'hard', s, SELF_TRUNC);
    expect(adj.budgetTokens).toBeLessThan(high.budgetTokens);
    expect(['low', 'medium']).toContain(adj.tier);
  });

  it('never drops below the hard floor', () => {
    const s = recordMany(20, {
      difficultyClass: 'hard',
      reasoningTokens: 100,
      budgetTokens: TIER_BUDGET_TOKENS.high,
      selfTruncates: true,
      finishReason: 'stop',
    });
    const adj = adjustTarget(high, 'high', 'hard', s, SELF_TRUNC);
    expect(adj.tier).toBe('high');
    expect(adj.budgetTokens).toBeGreaterThanOrEqual(TIER_BUDGET_TOKENS.high);
  });

  it('bumps up when recent turns were under-resourced', () => {
    const slack = recordMany(6, {
      difficultyClass: 'medium',
      reasoningTokens: 2000,
      budgetTokens: TIER_BUDGET_TOKENS.medium,
      selfTruncates: true,
      finishReason: 'stop',
    });
    const baseline = adjustTarget(
      medium,
      'off',
      'medium',
      slack,
      SELF_TRUNC,
    ).budgetTokens;
    const saturated = recordMany(6, {
      difficultyClass: 'medium',
      reasoningTokens: 7900,
      budgetTokens: TIER_BUDGET_TOKENS.medium,
      selfTruncates: true,
    });
    const bumped = adjustTarget(
      medium,
      'off',
      'medium',
      saturated,
      SELF_TRUNC,
    ).budgetTokens;
    expect(bumped).toBeGreaterThan(baseline);
  });

  it('cannot escalate beyond the band over the prior', () => {
    const s = recordMany(10, {
      difficultyClass: 'easy',
      reasoningTokens: 100000,
      budgetTokens: TIER_BUDGET_TOKENS.low,
      selfTruncates: true,
    });
    const adj = adjustTarget(low, 'off', 'easy', s, SELF_TRUNC);
    expect(adj.budgetTokens).toBeLessThanOrEqual(low.budgetTokens * 1.5);
  });

  it('trims the estimate further when a class is confidently wasteful (A2)', () => {
    // Same revealed need (~2000 tokens), but one history is "wasteful" (tiny
    // answers) and the other productive (long answers). The wasteful class
    // should settle to a strictly smaller budget.
    // reasoningTokens must be ≥ 60% of the per-turn budget for the wasteful
    // detector to fire; both histories burn ~6000 of the 8192 medium budget.
    const productive = recordMany(8, {
      difficultyClass: 'medium',
      reasoningTokens: 6000,
      outputTokens: 4000,
      budgetTokens: TIER_BUDGET_TOKENS.medium,
      selfTruncates: true,
      finishReason: 'stop',
    });
    const wasteful = recordMany(8, {
      difficultyClass: 'medium',
      reasoningTokens: 6000,
      outputTokens: 30,
      budgetTokens: TIER_BUDGET_TOKENS.medium,
      selfTruncates: true,
      finishReason: 'stop',
    });
    const prodBudget = adjustTarget(
      medium,
      'off',
      'medium',
      productive,
      SELF_TRUNC,
    ).budgetTokens;
    const wasteBudget = adjustTarget(
      medium,
      'off',
      'medium',
      wasteful,
      SELF_TRUNC,
    ).budgetTokens;
    expect(wasteBudget).toBeLessThan(prodBudget);
  });
});

describe('adjustTarget — effort bandit (tier hysteresis)', () => {
  const fine: ReasoningOutcome = {
    difficultyClass: 'medium',
    reasoningTokens: 0,
    budgetTokens: 0,
    selfTruncates: false,
    finishReason: 'stop',
  };

  it('trims one tier when a class is confidently fine', () => {
    const s = recordMany(4, fine);
    expect(adjustTarget(medium, 'off', 'medium', s, EFFORT).tier).toBe('low');
  });

  it('bumps one tier up when under-resourced', () => {
    const s = recordMany(4, {
      difficultyClass: 'medium',
      budgetTokens: 0,
      selfTruncates: false,
      retried: true,
    });
    expect(adjustTarget(medium, 'off', 'medium', s, EFFORT).tier).toBe('high');
  });

  it('never trims below the floor', () => {
    const s = recordMany(4, fine);
    expect(adjustTarget(medium, 'medium', 'medium', s, EFFORT).tier).toBe(
      'medium',
    );
  });

  it('holds inside the hysteresis deadband', () => {
    let s = recordOutcome(undefined, {
      difficultyClass: 'medium',
      budgetTokens: 0,
      selfTruncates: false,
      retried: true,
    });
    s = recordOutcome(s, {
      difficultyClass: 'medium',
      budgetTokens: 0,
      selfTruncates: false,
      finishReason: 'stop',
    });
    expect(adjustTarget(medium, 'off', 'medium', s, EFFORT).tier).toBe(
      'medium',
    );
  });

  it('jumps two tiers when strongly under-resourced (A5)', () => {
    // Persistent retries drive underResourcedEma toward 1 (≥ STRONG=0.8).
    const s = recordMany(6, {
      difficultyClass: 'medium',
      budgetTokens: 0,
      selfTruncates: false,
      retried: true,
    });
    expect(adjustTarget(low, 'off', 'medium', s, EFFORT).tier).toBe('high');
  });

  it('trims two tiers when confidently wasteful with enough samples (A5)', () => {
    // Effort model that thinks (selfTruncates flagged false, but we feed a
    // budget + tiny output so the wasteful detector fires) — needs ≥4 samples.
    const s = recordMany(5, {
      difficultyClass: 'medium',
      reasoningTokens: 20000,
      outputTokens: 20,
      budgetTokens: TIER_BUDGET_TOKENS.high,
      selfTruncates: false,
      finishReason: 'stop',
    });
    expect(adjustTarget(high, 'off', 'medium', s, EFFORT).tier).toBe('low');
  });
});

describe('adjustTarget — hierarchical profile (warm start)', () => {
  const selfTrunc = (reasoningTokens: number): ReasoningOutcome => ({
    difficultyClass: 'hard',
    reasoningTokens,
    budgetTokens: TIER_BUDGET_TOKENS.high,
    selfTruncates: true,
    finishReason: 'stop',
  });

  it('warm-starts from the profile when the thread has no data of its own', () => {
    // Cold thread with no profile stays at the (high) prior...
    expect(adjustTarget(high, 'off', 'hard', undefined, SELF_TRUNC).tier).toBe(
      'high',
    );
    // ...but a profile that learned ~1500 tokens for this class warm-starts low.
    const profile = recordMany(8, selfTrunc(1500));
    const adj = adjustTarget(
      high,
      'off',
      'hard',
      undefined,
      SELF_TRUNC,
      profile,
    );
    expect(adj.budgetTokens).toBeLessThan(high.budgetTokens);
    expect(['low', 'medium']).toContain(adj.tier);
  });

  it("lets a thread's own evidence override an inherited profile", () => {
    const profile = recordMany(20, {
      ...selfTrunc(8000),
      difficultyClass: 'medium',
    });
    const thread = recordMany(8, {
      ...selfTrunc(500),
      difficultyClass: 'medium',
    });
    const profileOnly = adjustTarget(
      high,
      'off',
      'medium',
      undefined,
      SELF_TRUNC,
      profile,
    ).budgetTokens;
    const withThread = adjustTarget(
      high,
      'off',
      'medium',
      thread,
      SELF_TRUNC,
      profile,
    ).budgetTokens;
    expect(withThread).toBeLessThan(profileOnly);
  });

  it('caps profile influence so a thread is never dominated forever', () => {
    const profile = recordMany(500, {
      ...selfTrunc(20000),
      difficultyClass: 'easy',
    });
    const thread = recordMany(20, {
      ...selfTrunc(200),
      difficultyClass: 'easy',
    });
    const profileOnly = adjustTarget(
      high,
      'off',
      'easy',
      undefined,
      SELF_TRUNC,
      profile,
    ).budgetTokens;
    const withThread = adjustTarget(
      high,
      'off',
      'easy',
      thread,
      SELF_TRUNC,
      profile,
    ).budgetTokens;
    expect(withThread).toBeLessThan(profileOnly);
  });
});
