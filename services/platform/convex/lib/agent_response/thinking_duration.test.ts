import { describe, it, expect } from 'vitest';

import { computeThinkingDurationMs } from './abort_watcher';

describe('computeThinkingDurationMs', () => {
  const turnStartMs = 1_000;

  it('measures to the first answer token when one arrived', () => {
    expect(computeThinkingDurationMs(11_000, turnStartMs, 20_000)).toBe(10_000);
  });

  it('falls back to the turn end for a reasoning/tool-only turn (no answer token)', () => {
    // Regression for #2372: a turn that never produced a first answer token
    // must still persist a thinking duration so "Thought for Ns" survives a
    // reload, rather than dropping to undefined.
    expect(computeThinkingDurationMs(null, turnStartMs, 20_000)).toBe(19_000);
  });

  it('never returns undefined for a no-token turn', () => {
    expect(
      computeThinkingDurationMs(null, turnStartMs, 20_000),
    ).not.toBeUndefined();
  });
});
