import { describe, expect, it } from 'vitest';

import {
  COMPACTION_TRIGGER_RATIO,
  computeCompactionSplit,
  MAX_HISTORY_BUDGET_TOKENS,
  resolveContextBudget,
  resolveEffectiveContextWindow,
  shouldCompact,
} from './budget';

describe('resolveContextBudget', () => {
  it('falls back to the default window when none is given (128K → 76.8K)', () => {
    expect(resolveContextBudget({})).toBe(Math.round(128_000 * 0.6));
  });

  it('scales with the model context window', () => {
    expect(resolveContextBudget({ contextWindow: 100_000 })).toBe(60_000);
  });

  it('caps at MAX_HISTORY_BUDGET_TOKENS for very large windows', () => {
    expect(resolveContextBudget({ contextWindow: 1_000_000 })).toBe(
      MAX_HISTORY_BUDGET_TOKENS,
    );
  });

  it('never dips below the per-agent floor on small windows', () => {
    // 0.6 * 16K = 9.6K, floored to the agent default (25K).
    expect(
      resolveContextBudget({ contextWindow: 16_000, agentDefault: 25_000 }),
    ).toBe(25_000);
  });

  it('lets a governance cap pull the budget below the floor', () => {
    expect(
      resolveContextBudget({
        contextWindow: 200_000,
        agentDefault: 25_000,
        governanceMaxContext: 10_000,
      }),
    ).toBe(10_000);
  });

  it('treats a zero/negative window as "unknown" (default)', () => {
    expect(resolveContextBudget({ contextWindow: 0 })).toBe(
      Math.round(128_000 * 0.6),
    );
  });
});

describe('shouldCompact', () => {
  const budget = 80_000;
  it('triggers at/above the threshold', () => {
    expect(shouldCompact(COMPACTION_TRIGGER_RATIO * budget, budget)).toBe(true);
    expect(shouldCompact(budget, budget)).toBe(true);
  });
  it('does not trigger below the threshold', () => {
    expect(shouldCompact(COMPACTION_TRIGGER_RATIO * budget - 1, budget)).toBe(
      false,
    );
  });
  it('does not trigger when usage is unavailable', () => {
    expect(shouldCompact(undefined, budget)).toBe(false);
    expect(shouldCompact(Number.NaN, budget)).toBe(false);
  });
});

describe('resolveEffectiveContextWindow', () => {
  it('uses the model window, default fallback when unknown', () => {
    expect(resolveEffectiveContextWindow({ contextWindow: 200_000 })).toBe(
      200_000,
    );
    expect(resolveEffectiveContextWindow({})).toBe(128_000);
    expect(resolveEffectiveContextWindow({ contextWindow: 0 })).toBe(128_000);
  });

  it('caps by the governance limit', () => {
    expect(
      resolveEffectiveContextWindow({
        contextWindow: 200_000,
        governanceMaxContext: 32_000,
      }),
    ).toBe(32_000);
  });

  it('is much larger than the history budget so the trigger fires near the real window, not early', () => {
    const window = resolveEffectiveContextWindow({ contextWindow: 200_000 });
    const historyBudget = resolveContextBudget({ contextWindow: 200_000 });
    // Triggering at 90% of the window must require far more input than 90% of
    // the (smaller) history budget — this is the calibration the fix restores.
    expect(COMPACTION_TRIGGER_RATIO * window).toBeGreaterThan(
      COMPACTION_TRIGGER_RATIO * historyBudget,
    );
  });
});

describe('computeCompactionSplit', () => {
  it('summarizes nothing when everything fits the keep budget', () => {
    expect(computeCompactionSplit([10, 10, 10], 100)).toBe(0);
  });

  it('keeps the most-recent messages that fit, summarizes the rest', () => {
    // sizes oldest→newest; keepBudget 25. Newest (10) + next (10) = 20 <= 25;
    // adding the third-newest (10) = 30 > 25 → split before it.
    expect(computeCompactionSplit([10, 10, 10, 10], 25)).toBe(2);
  });

  it('summarizes everything when even the newest message exceeds the keep budget', () => {
    // Newest alone (10) already exceeds keep budget 5 → split is n (keep none).
    expect(computeCompactionSplit([10, 10, 10], 5)).toBe(3);
  });

  it('handles an empty list', () => {
    expect(computeCompactionSplit([], 100)).toBe(0);
  });
});
