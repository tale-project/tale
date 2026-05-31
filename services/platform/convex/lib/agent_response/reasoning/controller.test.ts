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

  it('flags under-resourced on retry, length-finish, or saturation', () => {
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
