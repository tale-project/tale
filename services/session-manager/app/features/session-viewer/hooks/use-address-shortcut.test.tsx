import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAddressShortcut } from './use-address-shortcut';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAddressShortcut', () => {
  it('names the key of the way out of the page on a computer that is not a Mac', () => {
    const { result } = renderHook(() => useAddressShortcut());
    expect(result.current).toEqual({
      label: 'Ctrl+L',
      name: 'Control+L',
      keys: 'Control+L',
    });
  });

  it('names it as a Mac does', () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { result } = renderHook(() => useAddressShortcut());
    expect(result.current).toEqual({
      label: '⌘ L',
      name: 'Command+L',
      keys: 'Meta+L',
    });
  });
});
