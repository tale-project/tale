import { render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { useImeComposition } from './use-ime-composition';

describe('useImeComposition', () => {
  it('ends a closed session even while its target is still connected', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useImeComposition(active),
      { initialProps: { active: true } },
    );
    result.current.compositionProps.onCompositionStart({
      target: document.body,
    });
    expect(result.current.isComposing()).toBe(true);
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.isComposing()).toBe(false);
    result.current.compositionProps.onCompositionStart({
      target: document.body,
    });
    rerender({ active: true });
    expect(result.current.isComposing()).toBe(true);
  });

  it('tracks composition across renders and resets when it ends or focus leaves', () => {
    const { result, rerender } = renderHook(() => useImeComposition());
    const ordinary = { isComposing: false, keyCode: 13 };
    expect(result.current.isComposing(ordinary)).toBe(false);
    result.current.compositionProps.onCompositionStart({
      target: document.body,
    });
    rerender();
    expect(result.current.isComposing(ordinary)).toBe(true);
    expect(result.current.isComposing()).toBe(true);
    result.current.compositionProps.onCompositionEnd();
    expect(result.current.isComposing(ordinary)).toBe(false);
    result.current.compositionProps.onCompositionStart({
      target: document.body,
    });
    result.current.compositionProps.onBlur();
    expect(result.current.isComposing()).toBe(false);
  });

  it('recognizes the native flag and Safari 229 after compositionend', () => {
    const { result } = renderHook(() => useImeComposition());
    result.current.compositionProps.onCompositionStart({
      target: document.body,
    });
    result.current.compositionProps.onCompositionEnd();
    expect(result.current.isComposing({ isComposing: true, keyCode: 13 })).toBe(
      true,
    );
    expect(
      result.current.isComposing({ isComposing: false, keyCode: 229 }),
    ).toBe(true);
    expect(
      result.current.isComposing({ isComposing: false, keyCode: 27 }),
    ).toBe(false);
  });

  it('forgets an unmounted composing field without resetting a newly mounted field', () => {
    const { result } = renderHook(() => useImeComposition());
    const first = render(createElement('input'));
    result.current.compositionProps.onCompositionStart({
      target: first.container.firstChild,
    });
    expect(result.current.isComposing()).toBe(true);
    first.unmount();
    expect(result.current.isComposing()).toBe(false);
    const second = render(createElement('input'));
    result.current.compositionProps.onCompositionStart({
      target: second.container.firstChild,
    });
    expect(result.current.isComposing()).toBe(true);
  });
});
