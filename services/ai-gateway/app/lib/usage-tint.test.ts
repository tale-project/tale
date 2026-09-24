import { describe, expect, it } from 'vitest';

import { spentPercent, usageTint } from '@/app/lib/usage-tint';

describe('usageTint', () => {
  it.each([
    [0, 'bg-green-500'],
    [49, 'bg-green-500'],
    [50, 'bg-yellow-500'],
    [74, 'bg-yellow-500'],
    [75, 'bg-orange-500'],
    [94, 'bg-orange-500'],
    [95, 'bg-gradient-to-r from-orange-500 to-red-500'],
    [99, 'bg-gradient-to-r from-orange-500 to-red-500'],
    [100, 'bg-red-500'],
  ])('paints a window %i%% spent %s', (percent, tint) => {
    expect(usageTint(percent)).toBe(tint);
  });

  it('never paints a spent window green', () => {
    expect(usageTint(100)).not.toContain('green');
  });
});

describe('spentPercent', () => {
  it('rounds down, so a window with anything left is not called spent', () => {
    expect(spentPercent(99.6)).toBe(99);
    expect(usageTint(spentPercent(99.6))).not.toBe('bg-red-500');
  });

  it('reads a window with no figure as none of it spent', () => {
    expect(spentPercent(null)).toBe(0);
  });
});
