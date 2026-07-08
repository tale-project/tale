// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  useOptionalViewState,
  useViewState,
  type ViewStateData,
  ViewStateProvider,
  viewStateReducer,
} from './view-state';

const empty: ViewStateData = { state: {}, selectionIds: {} };

describe('viewStateReducer', () => {
  it('writes a state key without touching selections', () => {
    const next = viewStateReducer(empty, {
      type: 'setState',
      key: 'conversationId',
      value: 'c1',
    });
    expect(next.state).toEqual({ conversationId: 'c1' });
    expect(next.selectionIds).toBe(empty.selectionIds);
  });

  it('clears a state key with undefined (so `$state.<key>` gates again)', () => {
    const withKey = viewStateReducer(empty, {
      type: 'setState',
      key: 'conversationId',
      value: 'c1',
    });
    const cleared = viewStateReducer(withKey, {
      type: 'setState',
      key: 'conversationId',
      value: undefined,
    });
    expect(cleared.state.conversationId).toBeUndefined();
  });

  it('is a no-op (same object) when writing the current value', () => {
    const withKey = viewStateReducer(empty, {
      type: 'setState',
      key: 'taskId',
      value: 't1',
    });
    expect(
      viewStateReducer(withKey, {
        type: 'setState',
        key: 'taskId',
        value: 't1',
      }),
    ).toBe(withKey);
  });

  it('replaces a block’s selection ids and no-ops on an identical list', () => {
    const withIds = viewStateReducer(empty, {
      type: 'setSelectionIds',
      key: 'inbox',
      ids: ['a', 'b'],
    });
    expect(withIds.selectionIds).toEqual({ inbox: ['a', 'b'] });
    expect(
      viewStateReducer(withIds, {
        type: 'setSelectionIds',
        key: 'inbox',
        ids: ['a', 'b'],
      }),
    ).toBe(withIds);
    const replaced = viewStateReducer(withIds, {
      type: 'setSelectionIds',
      key: 'inbox',
      ids: ['b'],
    });
    expect(replaced.selectionIds).toEqual({ inbox: ['b'] });
  });

  it('keys selections independently per block', () => {
    const one = viewStateReducer(empty, {
      type: 'setSelectionIds',
      key: 'inbox',
      ids: ['a'],
    });
    const two = viewStateReducer(one, {
      type: 'setSelectionIds',
      key: 'archive',
      ids: ['z'],
    });
    expect(two.selectionIds).toEqual({ inbox: ['a'], archive: ['z'] });
  });
});

function wrapper({ children }: { children: ReactNode }) {
  return <ViewStateProvider>{children}</ViewStateProvider>;
}

describe('ViewStateProvider + hooks', () => {
  it('shares one store: setState is visible to every consumer', () => {
    const { result } = renderHook(() => useViewState(), { wrapper });
    expect(result.current.state).toEqual({});
    act(() => result.current.setState('conversationId', 'c9'));
    expect(result.current.state).toEqual({ conversationId: 'c9' });
    act(() => result.current.setSelectionIds('inbox', ['c9', 'c10']));
    expect(result.current.selectionIds).toEqual({ inbox: ['c9', 'c10'] });
  });

  it('a nested provider adopts the ancestor store (one view = one state)', () => {
    // Mirrors a split tab: the shell provides once; per-column `AutomationView`
    // providers must NOT shadow it, or master-detail selection breaks.
    const nestedWrapper = ({ children }: { children: ReactNode }) => (
      <ViewStateProvider>
        <ViewStateProvider>{children}</ViewStateProvider>
      </ViewStateProvider>
    );
    const { result } = renderHook(() => useViewState(), {
      wrapper: nestedWrapper,
    });
    act(() => result.current.setState('taskId', 't1'));
    expect(result.current.state).toEqual({ taskId: 't1' });
  });

  it('useOptionalViewState returns null outside a provider (standalone-safe)', () => {
    const { result } = renderHook(() => useOptionalViewState());
    expect(result.current).toBeNull();
  });

  it('useViewState throws outside a provider (selection writers fail loudly)', () => {
    expect(() => renderHook(() => useViewState())).toThrow(/ViewStateProvider/);
  });
});
