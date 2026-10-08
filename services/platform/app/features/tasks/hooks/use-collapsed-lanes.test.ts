import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { isCollapsibleLane, useCollapsedLanes } from './use-collapsed-lanes';

afterEach(() => {
  window.localStorage.clear();
});

describe('useCollapsedLanes', () => {
  it('folds only the lanes where finished work piles up', () => {
    expect(isCollapsibleLane('done')).toBe(true);
    expect(isCollapsibleLane('cancelled')).toBe(true);
    expect(isCollapsibleLane('todo')).toBe(false);

    const { result } = renderHook(() => useCollapsedLanes('project-1'));
    act(() => result.current.setCollapsed('todo', true));
    expect(result.current.collapsed.size).toBe(0);
    act(() => result.current.setCollapsed('done', true));
    expect([...result.current.collapsed]).toEqual(['done']);
  });

  it('remembers each board on its own, across a reload', () => {
    const first = renderHook(() => useCollapsedLanes('project-1'));
    act(() => first.result.current.setCollapsed('cancelled', true));
    first.unmount();

    const again = renderHook(() => useCollapsedLanes('project-1'));
    expect(again.result.current.collapsed.has('cancelled')).toBe(true);
    const other = renderHook(() => useCollapsedLanes('project-2'));
    expect(other.result.current.collapsed.size).toBe(0);

    act(() => again.result.current.setCollapsed('cancelled', false));
    expect(again.result.current.collapsed.size).toBe(0);
  });

  it('ignores a stored lane that cannot fold', () => {
    window.localStorage.setItem(
      'tale.platform.tasks.board.collapsedLanes.project-1',
      JSON.stringify(['todo', 'done']),
    );
    const { result } = renderHook(() => useCollapsedLanes('project-1'));
    expect([...result.current.collapsed]).toEqual(['done']);
  });
});
