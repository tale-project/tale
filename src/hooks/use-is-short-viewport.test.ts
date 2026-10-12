import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHORT_VIEWPORT_QUERY,
  useIsShortViewport,
} from './use-is-short-viewport';

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

describe('useIsShortViewport', () => {
  beforeEach(() => {
    mockMatchMedia({});
  });

  it('is true where the short-viewport variant applies', () => {
    mockMatchMedia({ [SHORT_VIEWPORT_QUERY]: true });
    const { result } = renderHook(() => useIsShortViewport());
    expect(result.current).toBe(true);
  });

  it('is false on a viewport tall enough to bound a page', () => {
    const { result } = renderHook(() => useIsShortViewport());
    expect(result.current).toBe(false);
  });

  // The script and the stylesheet must switch at the same height: a table
  // the CSS has unbounded while its infinite list still watches the table's
  // own scrolling would load every page at once.
  it('reads the same query the stylesheet declares', () => {
    const css = readFileSync(join(__dirname, '../globals.css'), 'utf8');
    expect(css).toContain(
      `@custom-variant short-viewport (@media ${SHORT_VIEWPORT_QUERY});`,
    );
  });
});
