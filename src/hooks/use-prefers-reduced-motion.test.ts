import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  usePrefersReducedMotion,
} from './use-prefers-reduced-motion';

const original = window.matchMedia;

function setReduced(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === REDUCED_MOTION_QUERY && reduced,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  window.matchMedia = original;
});

describe('usePrefersReducedMotion', () => {
  it('reads the reduce-motion setting', () => {
    setReduced(true);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(
      true,
    );
    expect(prefersReducedMotion()).toBe(true);
  });

  it('is false when the user did not ask for less motion', () => {
    setReduced(false);
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(
      false,
    );
    expect(prefersReducedMotion()).toBe(false);
  });
});
