import { describe, expect, it } from 'vitest';

import { getActiveLoopProgress } from './get_active_loop_progress';

describe('getActiveLoopProgress', () => {
  it('returns null for null input', () => {
    expect(getActiveLoopProgress(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(getActiveLoopProgress(undefined)).toBeNull();
  });

  it('returns null for non-record input', () => {
    expect(getActiveLoopProgress('string')).toBeNull();
    expect(getActiveLoopProgress(42)).toBeNull();
    expect(getActiveLoopProgress(true)).toBeNull();
  });

  it('returns null when state is missing', () => {
    expect(getActiveLoopProgress({ item: 'foo' })).toBeNull();
  });

  it('returns null when state lacks required fields', () => {
    expect(getActiveLoopProgress({ state: { currentIndex: 0 } })).toBeNull();
    expect(getActiveLoopProgress({ state: { totalItems: 3 } })).toBeNull();
  });

  it('returns progress for active loop at first iteration', () => {
    const loop = {
      state: { currentIndex: 0, totalItems: 3, isComplete: false },
    };
    expect(getActiveLoopProgress(loop)).toEqual({ current: 1, total: 3 });
  });

  it('returns progress for active loop at middle iteration', () => {
    const loop = {
      state: { currentIndex: 1, totalItems: 3, isComplete: false },
    };
    expect(getActiveLoopProgress(loop)).toEqual({ current: 2, total: 3 });
  });

  it('returns progress for active loop at last iteration', () => {
    const loop = {
      state: { currentIndex: 2, totalItems: 3, isComplete: false },
    };
    expect(getActiveLoopProgress(loop)).toEqual({ current: 3, total: 3 });
  });

  it('returns null for completed loop', () => {
    const loop = {
      state: { currentIndex: 2, totalItems: 2, isComplete: true },
    };
    expect(getActiveLoopProgress(loop)).toBeNull();
  });

  it('returns null for completed loop with out-of-bounds currentIndex', () => {
    const loop = {
      state: { currentIndex: 3, totalItems: 2, isComplete: true },
    };
    expect(getActiveLoopProgress(loop)).toBeNull();
  });

  it('returns progress when isComplete is missing (backwards compat)', () => {
    const loop = {
      state: { currentIndex: 1, totalItems: 5 },
    };
    expect(getActiveLoopProgress(loop)).toEqual({ current: 2, total: 5 });
  });

  it('returns progress for single-item loop in progress', () => {
    const loop = {
      state: { currentIndex: 0, totalItems: 1, isComplete: false },
    };
    expect(getActiveLoopProgress(loop)).toEqual({ current: 1, total: 1 });
  });

  it('returns null for single-item loop completed', () => {
    const loop = {
      state: { currentIndex: 1, totalItems: 1, isComplete: true },
    };
    expect(getActiveLoopProgress(loop)).toBeNull();
  });
});
