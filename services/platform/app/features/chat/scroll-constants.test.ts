import { describe, expect, it } from 'vitest';

import { resolveTopInset, TOP_INSET } from './scroll-constants';

describe('resolveTopInset', () => {
  it('falls back to TOP_INSET when padding is not yet measurable', () => {
    expect(resolveTopInset(0)).toBe(TOP_INSET);
    expect(resolveTopInset(Number.NaN)).toBe(TOP_INSET);
  });

  it('uses mobile content padding as the snap inset', () => {
    // `p-4` / `sm:p-6` — ordinary breathing room, no floating header.
    expect(resolveTopInset(16)).toBe(16);
    expect(resolveTopInset(24)).toBe(24);
  });

  it('clears the floating glass header via desktop content padding', () => {
    // Regression lock for #2805: send-snap used to hardcode TOP_INSET=16
    // against a full-height scroller under an absolute h-18 glass bar, so
    // short user bubbles landed half-hidden. Desktop content uses
    // `md:pt-19` (~76px) so slack and snap stay below the blur.
    expect(resolveTopInset(76)).toBe(76);
    expect(resolveTopInset(76)).toBeGreaterThan(TOP_INSET);
  });
});
