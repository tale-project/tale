import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBreakpoint } from './use-breakpoint';

function mockMatchMedia(matches: Record<string, boolean>) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('useBreakpoint', () => {
  beforeEach(() => {
    mockMatchMedia({});
  });

  it('returns mobile when no breakpoint matches', () => {
    mockMatchMedia({
      '(min-width: 768px)': false,
      '(min-width: 1024px)': false,
    });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('mobile');
  });

  it('returns tablet between 768px and 1024px', () => {
    mockMatchMedia({
      '(min-width: 768px)': true,
      '(min-width: 1024px)': false,
    });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('tablet');
  });

  it('returns desktop at 1024px and above', () => {
    mockMatchMedia({
      '(min-width: 768px)': true,
      '(min-width: 1024px)': true,
    });
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('desktop');
  });
});
