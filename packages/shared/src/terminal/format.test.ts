import { describe, expect, it } from 'vitest';

import { formatElapsed } from './format.ts';

describe('formatElapsed', () => {
  it('uses one decimal under 10s, whole seconds under a minute, m+s above', () => {
    expect(formatElapsed(400)).toBe('0.4s');
    expect(formatElapsed(5200)).toBe('5.2s');
    expect(formatElapsed(12_000)).toBe('12s');
    expect(formatElapsed(64_000)).toBe('1m04s');
  });

  it('clamps negative input to zero', () => {
    expect(formatElapsed(-5)).toBe('0.0s');
  });
});
