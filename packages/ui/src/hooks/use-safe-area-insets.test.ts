import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSafeAreaInsets } from './use-safe-area-insets';

describe('useSafeAreaInsets', () => {
  it('returns zeros in jsdom (no `env()` support)', () => {
    const { result } = renderHook(() => useSafeAreaInsets());
    expect(result.current).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
