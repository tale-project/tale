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

describe('saved lane preference recovery', () => {
  it.each([{}, null, 'done', 42, true])(
    'recovers from a non-array preference %j and persists later actions',
    (stored) => {
      const key = 'tale.platform.tasks.board.collapsedLanes.project-1';
      const other = 'tale.platform.tasks.board.collapsedLanes.project-2';
      window.localStorage.setItem(key, JSON.stringify(stored));
      window.localStorage.setItem(other, '["cancelled"]');
      window.localStorage.setItem('unrelated-preference', '{"theme":"dark"}');
      const first = renderHook(() => useCollapsedLanes('project-1'));
      expect([...first.result.current.collapsed]).toEqual([]);
      act(() => first.result.current.setCollapsed('cancelled', false));
      act(() => first.result.current.setCollapsed('done', true));
      expect(window.localStorage.getItem(key)).toBe('["done"]');
      first.unmount();
      const again = renderHook(() => useCollapsedLanes('project-1'));
      expect([...again.result.current.collapsed]).toEqual(['done']);
      act(() => again.result.current.setCollapsed('done', false));
      expect(window.localStorage.getItem(key)).toBe('[]');
      expect(window.localStorage.getItem(other)).toBe('["cancelled"]');
      expect(window.localStorage.getItem('unrelated-preference')).toBe(
        '{"theme":"dark"}',
      );
    },
  );

  it('keeps valid entries in a mixed array and removes invalid entries on write', () => {
    const key = 'tale.platform.tasks.board.collapsedLanes.project-1';
    window.localStorage.setItem(
      key,
      JSON.stringify([
        'done',
        null,
        {},
        7,
        false,
        ['cancelled'],
        'todo',
        'cancelled',
      ]),
    );
    const { result } = renderHook(() => useCollapsedLanes('project-1'));
    expect([...result.current.collapsed]).toEqual(['done', 'cancelled']);
    act(() => result.current.setCollapsed('done', false));
    expect(window.localStorage.getItem(key)).toBe('["cancelled"]');
  });

  it('validates a newly selected board before reading or updating it', () => {
    window.localStorage.setItem(
      'tale.platform.tasks.board.collapsedLanes.project-1',
      '["done"]',
    );
    window.localStorage.setItem(
      'tale.platform.tasks.board.collapsedLanes.all',
      '{}',
    );
    const { result, rerender } = renderHook(
      ({ scope }) => useCollapsedLanes(scope),
      { initialProps: { scope: 'project-1' } },
    );
    expect([...result.current.collapsed]).toEqual(['done']);
    rerender({ scope: 'all' });
    expect([...result.current.collapsed]).toEqual([]);
    act(() => result.current.setCollapsed('cancelled', true));
    expect(
      window.localStorage.getItem(
        'tale.platform.tasks.board.collapsedLanes.all',
      ),
    ).toBe('["cancelled"]');
    expect(
      window.localStorage.getItem(
        'tale.platform.tasks.board.collapsedLanes.project-1',
      ),
    ).toBe('["done"]');
  });
});
