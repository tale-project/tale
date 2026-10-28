import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockMotionPreference } from '../../tests/utils/motion-preference';
import { useReducedMotion } from './entrance';

function MotionPreference() {
  return <span>{String(useReducedMotion())}</span>;
}

describe('marketing motion preference', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders static demo content on the server', () => {
    vi.stubGlobal('window', undefined);
    expect(renderToString(<MotionPreference />)).toBe('<span>true</span>');
  });

  it('reads the initial browser preference and reacts to live changes', () => {
    const preference = mockMotionPreference(true);
    const { result } = renderHook(useReducedMotion);
    expect(result.current).toBe(true);
    act(() => preference.change(false));
    expect(result.current).toBe(false);
    act(() => preference.change(true));
    expect(result.current).toBe(true);
  });
});
