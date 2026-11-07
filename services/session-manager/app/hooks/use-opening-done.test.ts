import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOpeningDone } from './use-opening-done';

afterEach(() => {
  delete document.documentElement.dataset.opening;
  vi.restoreAllMocks();
});

describe('useOpeningDone', () => {
  it('lets transitions run again a frame after the first commit, not before', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.dataset.opening = '';

    renderHook(() => useOpeningDone());
    expect(document.documentElement.dataset.opening).toBe('');

    for (const callback of frames) callback(performance.now());
    expect(document.documentElement.dataset.opening).toBeUndefined();
  });
});
