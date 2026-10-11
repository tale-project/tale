import { describe, expect, it } from 'vitest';

import { EXECUTION_TIERS, highestTier, tierAbove } from './tiers';

describe('execution tiers', () => {
  it('order by cost: none, light, full', () => {
    expect(EXECUTION_TIERS).toEqual(['none', 'light', 'full']);
    expect(tierAbove('light', 'none')).toBe(true);
    expect(tierAbove('full', 'light')).toBe(true);
    expect(tierAbove('none', 'light')).toBe(false);
    expect(tierAbove('light', 'light')).toBe(false);
  });

  it('names the most expensive tier a turn needed', () => {
    expect(highestTier([])).toBe('none');
    expect(highestTier(['none', 'light', 'none'])).toBe('light');
    expect(highestTier(['full', 'light'])).toBe('full');
  });
});
