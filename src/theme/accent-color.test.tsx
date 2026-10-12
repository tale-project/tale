import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AccentColorProvider, useAccentColor } from './accent-color';

describe('useAccentColor', () => {
  it('is undefined for an unbranded surface', () => {
    const { result } = renderHook(() => useAccentColor());
    expect(result.current).toBeUndefined();
  });

  it('exposes the host accent to every descendant', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AccentColorProvider accentColor="#056cff">
        {children}
      </AccentColorProvider>
    );
    const { result } = renderHook(() => useAccentColor(), { wrapper });
    expect(result.current).toBe('#056cff');
  });

  it('lets a nested provider clear the accent again', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AccentColorProvider accentColor="#056cff">
        <AccentColorProvider>{children}</AccentColorProvider>
      </AccentColorProvider>
    );
    const { result } = renderHook(() => useAccentColor(), { wrapper });
    expect(result.current).toBeUndefined();
  });
});
