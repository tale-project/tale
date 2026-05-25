import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIsMobile } from './use-is-mobile';

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

describe('useIsMobile', () => {
  beforeEach(() => {
    mockMatchMedia({});
  });

  it('is true below 768px', () => {
    mockMatchMedia({ '(min-width: 768px)': false });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('is false at 768px and above', () => {
    mockMatchMedia({
      '(min-width: 768px)': true,
      '(min-width: 1024px)': false,
    });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
