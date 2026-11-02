import { describe, expect, it } from 'vitest';

import { arenaSideProvider } from './arena';

/**
 * Both readers of a verdict (the statistics and the recent list) take a
 * side's provider through `arenaSideProvider`, so a verdict that names none
 * must read as `null` everywhere, or one reader would pair it apart from
 * the other.
 */
describe('arenaSideProvider', () => {
  it('reads the provider a verdict names for a side [FDBK-R8]', () => {
    expect(arenaSideProvider('openrouter')).toBe('openrouter');
  });

  it('reads no provider on a verdict recorded before verdicts named providers [FDBK-R8]', () => {
    expect(arenaSideProvider(undefined)).toBeNull();
    expect(arenaSideProvider(null)).toBeNull();
    expect(arenaSideProvider('')).toBeNull();
    expect(arenaSideProvider(42)).toBeNull();
  });
});
