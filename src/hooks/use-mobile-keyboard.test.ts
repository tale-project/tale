import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMobileKeyboard } from './use-mobile-keyboard';

let viewport: EventTarget & { height: number; width: number; scale: number };
let media: EventTarget & { matches: boolean };
let input: HTMLTextAreaElement;

beforeEach(() => {
  viewport = Object.assign(new EventTarget(), {
    height: 844,
    width: 390,
    scale: 1,
  });
  media = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('matchMedia', () => media);
  input = document.createElement('textarea');
  document.body.append(input);
});
afterEach(() => {
  cleanup();
  input.remove();
  vi.unstubAllGlobals();
});

function resize(height: number) {
  act(() => {
    viewport.height = height;
    viewport.dispatchEvent(new Event('resize'));
  });
}

describe('useMobileKeyboard', () => {
  it('requires editable focus and a substantial viewport contraction', () => {
    const { result } = renderHook(useMobileKeyboard);
    act(() => input.focus());
    expect(result.current.open).toBe(false);
    resize(780);
    expect(result.current.open).toBe(false);
    resize(480);
    expect(result.current).toEqual({ open: true, height: 480 });
    act(() => input.blur());
    expect(result.current.open).toBe(true);
    resize(844);
    expect(result.current).toEqual({ open: false, height: undefined });
  });

  it('does not mistake window resizing without focus or pinch zoom for typing', () => {
    const { result } = renderHook(useMobileKeyboard);
    resize(500);
    expect(result.current.open).toBe(false);
    act(() => input.focus());
    viewport.scale = 2;
    resize(300);
    expect(result.current.open).toBe(false);
  });

  it('ignores readonly inputs and desktop viewports', () => {
    const { result } = renderHook(useMobileKeyboard);
    input.readOnly = true;
    act(() => input.focus());
    resize(480);
    expect(result.current.open).toBe(false);
    input.readOnly = false;
    media.matches = false;
    resize(450);
    expect(result.current.open).toBe(false);
  });

  it('releases the state on desktop transition and removes listeners on unmount', () => {
    const { result, unmount } = renderHook(useMobileKeyboard);
    const remove = vi.spyOn(viewport, 'removeEventListener');
    act(() => input.focus());
    resize(480);
    expect(result.current.open).toBe(true);
    act(() => {
      media.matches = false;
      media.dispatchEvent(new Event('change'));
    });
    expect(result.current.open).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('falls back without VisualViewport support', () => {
    vi.stubGlobal('visualViewport', undefined);
    const { result } = renderHook(useMobileKeyboard);
    act(() => input.focus());
    expect(result.current.open).toBe(false);
  });
});
