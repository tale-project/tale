// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PaginatedStatus } from './use-cached-paginated-query';
import { useViewedRecord } from './use-viewed-record';

interface Row {
  _id: string;
  name: string;
}

function setup(initial: { results: Row[]; status: PaginatedStatus }) {
  return renderHook(({ results, status }) => useViewedRecord(results, status), {
    initialProps: initial,
  });
}

describe('useViewedRecord', () => {
  it('reads the opened record from the live page', () => {
    const { result, rerender } = setup({
      results: [{ _id: 'a', name: 'Lamp' }],
      status: 'Exhausted',
    });

    act(() => result.current.open('a'));
    expect(result.current.record).toEqual({ _id: 'a', name: 'Lamp' });

    rerender({
      results: [{ _id: 'a', name: 'Desk lamp' }],
      status: 'Exhausted',
    });
    expect(result.current.record).toEqual({ _id: 'a', name: 'Desk lamp' });

    act(() => result.current.close());
    expect(result.current.record).toBeNull();
  });

  it('forgets a record that left the settled list, so it cannot reopen', () => {
    const lamp = { _id: 'a', name: 'Lamp' };
    const { result, rerender } = setup({
      results: [lamp],
      status: 'Exhausted',
    });

    act(() => result.current.open('a'));
    rerender({ results: [], status: 'Exhausted' });
    expect(result.current.record).toBeNull();

    // The record comes back (a filter cleared): the details stay closed.
    rerender({ results: [lamp], status: 'Exhausted' });
    expect(result.current.record).toBeNull();
  });

  it('keeps the id while a first page is still loading', () => {
    const lamp = { _id: 'a', name: 'Lamp' };
    const { result, rerender } = setup({
      results: [lamp],
      status: 'Exhausted',
    });

    act(() => result.current.open('a'));
    rerender({ results: [], status: 'LoadingFirstPage' });
    rerender({ results: [lamp], status: 'Exhausted' });

    expect(result.current.record).toEqual(lamp);
  });
});
