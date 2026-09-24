// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { useConfigDirtyState } from './use-config-dirty-state';

interface Cfg {
  a: number;
  b?: string;
  nested?: { x: number; y?: number };
}

// `initial` must be a STABLE reference across renders — exactly how consumers
// pass it (from a query cache / memo). Each test gets its own constant via the
// `initialProps` form of renderHook so internal re-renders don't feed a fresh
// object (which would make the external-sync effect re-run every render).
function mount(initial: Cfg) {
  return renderHook(
    ({ initial: i }: { initial: Cfg }) =>
      useConfigDirtyState<Cfg>({ initial: i }),
    { initialProps: { initial } },
  );
}

describe('useConfigDirtyState', () => {
  it('starts clean and becomes dirty on a real change', () => {
    const { result } = mount({ a: 1 });
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.updateConfig({ a: 2 }));
    expect(result.current.isDirty).toBe(true);
  });

  it('is not dirtied by key-order shuffles or undefined leaves', () => {
    const { result } = mount({ a: 1, nested: { x: 1, y: 2 } });

    act(() =>
      result.current.updateConfig({ nested: { y: 2, x: 1 }, b: undefined }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('clears dirty after markSaved even though config never changed (regression: stale ref baseline)', () => {
    // The provider/workflow contexts advanced an `initialRef` mutable ref on
    // save while leaving `config` untouched, so a `useMemo(..., [config])`
    // dirty flag stayed true after a successful save. State-based baseline
    // recomputes correctly.
    const { result } = mount({ a: 1 });

    act(() => result.current.updateConfig({ a: 2 }));
    expect(result.current.isDirty).toBe(true);

    act(() => result.current.markSaved(result.current.configRef.current));
    expect(result.current.isDirty).toBe(false);
  });

  it('resetConfig reverts the working copy to the baseline', () => {
    const { result } = mount({ a: 1 });
    act(() => result.current.updateConfig({ a: 9 }));
    expect(result.current.config.a).toBe(9);

    act(() => result.current.resetConfig());
    expect(result.current.config.a).toBe(1);
    expect(result.current.isDirty).toBe(false);
  });

  it('overrideConfig adopts a new shape as both copy and baseline', () => {
    const { result } = mount({ a: 1 });
    act(() => result.current.overrideConfig({ a: 5, b: 'x' }));
    expect(result.current.config).toEqual({ a: 5, b: 'x' });
    expect(result.current.isDirty).toBe(false);
  });

  it('adopts a changed `initial` while clean, but preserves live edits while dirty', () => {
    const { result, rerender } = renderHook(
      ({ initial }: { initial: Cfg }) => useConfigDirtyState<Cfg>({ initial }),
      { initialProps: { initial: { a: 1 } } },
    );

    // Clean → upstream change is adopted.
    rerender({ initial: { a: 2 } });
    expect(result.current.config.a).toBe(2);
    expect(result.current.isDirty).toBe(false);

    // Now dirty → upstream change must NOT clobber the edit.
    act(() => result.current.updateConfig({ a: 99 }));
    rerender({ initial: { a: 3 } });
    expect(result.current.config.a).toBe(99);
    expect(result.current.isDirty).toBe(true);
  });
});
