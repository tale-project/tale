import { useIsMobile } from '@tale/ui/use-is-mobile';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { stubViewport } from '@/tests/utils/viewport';

import { isPhoneViewport } from './viewport';

describe('isPhoneViewport', () => {
  it('is true on a phone and false on a computer', () => {
    stubViewport('phone');
    expect(isPhoneViewport()).toBe(true);
    stubViewport('desktop');
    expect(isPhoneViewport()).toBe(false);
  });

  it('says what the shell says: the page list and the redirect never disagree about a phone', () => {
    for (const viewport of ['phone', 'desktop'] as const) {
      stubViewport(viewport);
      const { result } = renderHook(() => useIsMobile());
      expect(isPhoneViewport()).toBe(result.current);
    }
  });
});
