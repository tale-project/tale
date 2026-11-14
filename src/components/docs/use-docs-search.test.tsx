import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDocsSearch } from './use-docs-search';

function key(options: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

describe('useDocsSearch', () => {
  it('opens lazily, toggles with either platform shortcut, and keeps the dialog mounted', () => {
    const { result, unmount } = renderHook(useDocsSearch);
    expect(result.current.searchMounted).toBe(false);
    expect(key({ ctrlKey: true }).defaultPrevented).toBe(true);
    expect(result.current.searchOpen).toBe(true);
    expect(result.current.searchMounted).toBe(true);
    key({ metaKey: true, key: 'K' });
    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchMounted).toBe(true);
    act(() => result.current.openSearch());
    expect(result.current.searchOpen).toBe(true);
    unmount();
    expect(key({ metaKey: true }).defaultPrevented).toBe(false);
  });

  it('leaves ordinary typing and modified shortcuts untouched', () => {
    const { result, unmount } = renderHook(useDocsSearch);
    for (const options of [
      {},
      { ctrlKey: true, altKey: true },
      { metaKey: true, shiftKey: true },
    ]) {
      expect(key(options).defaultPrevented).toBe(false);
    }
    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchMounted).toBe(false);
    unmount();
  });
});
