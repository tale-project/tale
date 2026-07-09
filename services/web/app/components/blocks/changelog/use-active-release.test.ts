import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useActiveRelease } from './use-active-release';

describe('useActiveRelease', () => {
  const tags = ['v0.3.3', 'v0.3.2', 'v0.3.1'] as const;
  /** Mutable tops keyed by tag — stubbed onto each article. */
  const tops: Record<string, number> = {
    'v0.3.3': 200,
    'v0.3.2': 600,
    'v0.3.1': 1000,
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    tops['v0.3.3'] = 200;
    tops['v0.3.2'] = 600;
    tops['v0.3.1'] = 1000;

    for (const tag of tags) {
      const el = document.createElement('article');
      el.id = tag;
      el.getBoundingClientRect = () => {
        const top = tops[tag] ?? 0;
        return {
          top,
          bottom: top + 300,
          left: 0,
          right: 0,
          width: 0,
          height: 300,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      };
      document.body.appendChild(el);
    }
    window.history.replaceState(null, '', '/changelog');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('defaults to the first tag', () => {
    const { result } = renderHook(() => useActiveRelease(tags));
    expect(result.current).toBe('v0.3.3');
  });

  it('advances to the last release whose top has crossed the offset', () => {
    tops['v0.3.3'] = -200;
    tops['v0.3.2'] = 80;
    tops['v0.3.1'] = 480;

    const { result } = renderHook(() => useActiveRelease(tags, 128));
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toBe('v0.3.2');
  });

  it('honours a hash while that article is near the offset', () => {
    window.history.replaceState(null, '', '/changelog#v0.3.1');
    tops['v0.3.1'] = 112;

    const { result } = renderHook(() => useActiveRelease(tags, 128));
    act(() => {
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(result.current).toBe('v0.3.1');
  });
});
