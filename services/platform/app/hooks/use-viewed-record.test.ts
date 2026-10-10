// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PaginatedStatus } from './use-cached-paginated-query';
import { useViewedRecord } from './use-viewed-record';

interface Row {
  _id: string;
  name: string;
  documentId?: string;
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

  it('follows a replaced version when the enduring identity is unchanged', () => {
    const { result, rerender } = renderHook(
      ({ results, status }) =>
        useViewedRecord(
          results,
          status,
          (record) => record.documentId ?? record._id,
        ),
      {
        initialProps: {
          results: [
            { _id: 'version-1', documentId: 'document-1', name: 'Old' },
          ],
          status: 'Exhausted' as PaginatedStatus,
        },
      },
    );

    act(() => result.current.open('document-1'));
    rerender({
      results: [{ _id: 'version-2', documentId: 'document-1', name: 'New' }],
      status: 'Exhausted',
    });

    expect(result.current.record).toEqual({
      _id: 'version-2',
      documentId: 'document-1',
      name: 'New',
    });
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
