import { describe, expect, it } from 'vitest';

import {
  adaptiveDifficultyThresholds,
  classFromIntensity,
  emptyReasoningState,
} from './types';

describe('adaptiveDifficultyThresholds (A6c)', () => {
  it('returns static defaults below the sample floor', () => {
    expect(adaptiveDifficultyThresholds(undefined)).toEqual({
      lo: 0.34,
      hi: 0.67,
    });
    const few = {
      ...emptyReasoningState(),
      intensityCount: 5,
      intensityMean: 0.5,
      intensityM2: 1,
    };
    expect(adaptiveDifficultyThresholds(few)).toEqual({ lo: 0.34, hi: 0.67 });
  });

  it('calibrates around the mean once enough samples exist, within clamps', () => {
    const skewed = {
      ...emptyReasoningState(),
      intensityCount: 50,
      intensityMean: 0.7,
      intensityM2: 50 * 0.02,
    };
    const t = adaptiveDifficultyThresholds(skewed);
    expect(t.lo).toBeGreaterThanOrEqual(0.2);
    expect(t.lo).toBeLessThanOrEqual(0.45);
    expect(t.hi).toBeGreaterThanOrEqual(0.55);
    expect(t.hi).toBeLessThanOrEqual(0.8);
    expect(t.lo).toBeLessThan(t.hi);
  });
});

describe('classFromIntensity with thresholds (A6c)', () => {
  it('reproduces the static mapping by default', () => {
    expect(classFromIntensity(0.1)).toBe('easy');
    expect(classFromIntensity(0.5)).toBe('medium');
    expect(classFromIntensity(0.9)).toBe('hard');
  });

  it('honors custom thresholds', () => {
    const t = { lo: 0.2, hi: 0.55 };
    expect(classFromIntensity(0.25, t)).toBe('medium');
    expect(classFromIntensity(0.6, t)).toBe('hard');
  });
});
