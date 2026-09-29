import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useListPage } from './use-list-page';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

interface TestItem {
  _id: string;
  name: string;
  category: string;
}

function makeItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `id_${i}`,
    name: `Item ${i}`,
    category: i % 2 === 0 ? 'even' : 'odd',
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderListPage(
  overrides: Partial<Parameters<typeof useListPage<TestItem>>[0]> = {},
) {
  const items =
    overrides.dataSource?.type === 'query'
      ? (overrides.dataSource.data ?? [])
      : makeItems(50);

  const defaults: Parameters<typeof useListPage<TestItem>>[0] = {
    dataSource: {
      type: 'query',
      data: items,
    },
    pageSize: 10,
    ...overrides,
  };

  return renderHook(() => useListPage<TestItem>(defaults));
}

// ---------------------------------------------------------------------------
// Tests — infinite scroll (default)
// ---------------------------------------------------------------------------

describe('useListPage — infiniteScroll mode (default)', () => {
  it('returns sliced data matching pageSize', () => {
    const { result } = renderListPage();

    expect(result.current.tableProps.data).toHaveLength(10);
    expect(result.current.totalCount).toBe(50);
    expect('infiniteScroll' in result.current.tableProps).toBe(true);
  });

  it('hasMore is true when more data is available', () => {
    const { result } = renderListPage();
    const props = result.current.tableProps;
    if ('infiniteScroll' in props) {
      expect(props.infiniteScroll.hasMore).toBe(true);
    }
  });

  it('does not eagerly drain backend pages while idle (no active filter)', () => {
    const loadMore = vi.fn();

    renderListPage({
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'CanLoadMore',
        loadMore,
        isLoading: false,
      },
      search: { fields: ['name'] },
    });

    expect(loadMore).not.toHaveBeenCalled();
  });

  it('eagerly drains backend pages while a search is active (#2054)', () => {
    const loadMore = vi.fn();

    const { result } = renderListPage({
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'CanLoadMore',
        loadMore,
        isLoading: false,
      },
      search: { fields: ['name'] },
    });

    const props = result.current.tableProps;
    if (props.search) {
      act(() => {
        props.search?.onChange('Item 99');
      });
    }

    // A search that matches nothing in the loaded buffer must keep loading
    // more backend pages instead of stranding the user on a false "no results".
    expect(loadMore).toHaveBeenCalled();
  });

  it('eagerly drains backend pages while a managed field filter is active', () => {
    const loadMore = vi.fn();

    const { result } = renderListPage({
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'CanLoadMore',
        loadMore,
        isLoading: false,
      },
      filters: {
        definitions: [
          {
            key: 'category',
            title: 'Category',
            options: [
              { value: 'even', label: 'Even' },
              { value: 'odd', label: 'Odd' },
            ],
          },
        ],
      },
    });

    const props = result.current.tableProps;
    act(() => {
      props.filters?.[0]?.onChange(['even']);
    });

    expect(loadMore).toHaveBeenCalled();
  });

  it('does not drain when backend is exhausted even with an active search', () => {
    const loadMore = vi.fn();

    const { result } = renderListPage({
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'Exhausted',
        loadMore,
        isLoading: false,
      },
      search: { fields: ['name'] },
    });

    const props = result.current.tableProps;
    if (props.search) {
      act(() => {
        props.search?.onChange('Item 99');
      });
    }

    expect(loadMore).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — active sort
// ---------------------------------------------------------------------------

describe('useListPage — active sort', () => {
  it('hands the table every processed row instead of the page window', () => {
    const { result } = renderListPage({
      sorting: [{ id: 'name', desc: false }],
    });

    // Without a sort this would be the 10-row `pageSize` slice; a sort that
    // only saw the first page would reshuffle rows as later pages arrived.
    expect(result.current.tableProps.data).toHaveLength(50);
  });

  it('reports no more rows once the backend is drained', () => {
    const { result } = renderListPage({
      sorting: [{ id: 'name', desc: true }],
      dataSource: {
        type: 'paginated',
        results: makeItems(50),
        status: 'Exhausted',
        loadMore: vi.fn(),
        isLoading: false,
      },
    });

    const props = result.current.tableProps;
    if ('infiniteScroll' in props) {
      expect(props.infiniteScroll.hasMore).toBe(false);
    }
  });

  it('eagerly drains backend pages while a sort is active', () => {
    const loadMore = vi.fn();

    renderListPage({
      sorting: [{ id: 'name', desc: false }],
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'CanLoadMore',
        loadMore,
        isLoading: false,
      },
    });

    expect(loadMore).toHaveBeenCalled();
  });

  it('keeps the page window when no column is sorted', () => {
    const loadMore = vi.fn();

    const { result } = renderListPage({
      sorting: [],
      dataSource: {
        type: 'paginated',
        results: makeItems(50),
        status: 'CanLoadMore',
        loadMore,
        isLoading: false,
      },
    });

    expect(result.current.tableProps.data).toHaveLength(10);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('never renders a client paginator — every list shares one footer', () => {
    const { result } = renderListPage({
      sorting: [{ id: 'name', desc: false }],
    });

    expect('pagination' in result.current.tableProps).toBe(false);
    expect('infiniteScroll' in result.current.tableProps).toBe(true);
  });
});

describe('useListPage — managed search', () => {
  it('matches a value the row only carries through an accessor', () => {
    // A label the host derives (a translated category name, say) is not a
    // field of the row, but it is what a reader types.
    const labels: Record<string, string> = { even: 'Gerade', odd: 'Ungerade' };
    const { result } = renderListPage({
      search: {
        fields: ['name', (item) => labels[item.category]],
      },
      entityLabel: { one: 'item', other: 'items' },
    });

    act(() => {
      result.current.tableProps.search?.onChange('ungerade');
    });

    expect(result.current.filteredCount).toBe(25);
    // The footer counts the matches against the whole set: "25 of 50".
    expect(result.current.tableProps.infiniteScroll.totalCount).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Tests — a failed request is an error state, never the empty state
// ---------------------------------------------------------------------------

describe('useListPage — failed request', () => {
  // "No projects yet" over a 500 read as data loss (2026-09-26 evaluation,
  // G-07): with nothing loaded the table gets the error and its retry.
  it('hands the table the error and the retry when nothing loaded', () => {
    const error = new Error('overview failed');
    const retry = vi.fn();
    const { result } = renderListPage({
      dataSource: { type: 'query', data: [], error, retry },
    });

    expect(result.current.tableProps.error).toBe(error);
    expect(result.current.tableProps.onRetry).toBe(retry);
    expect(result.current.tableProps.data).toEqual([]);
  });

  it('keeps loaded rows on screen through a failed refetch', () => {
    const { result } = renderListPage({
      dataSource: {
        type: 'query',
        data: makeItems(3),
        error: new Error('refetch failed'),
        retry: vi.fn(),
      },
    });

    expect(result.current.tableProps.error).toBeNull();
    expect(result.current.tableProps.data).toHaveLength(3);
  });

  it('does the same for a paginated source whose first page failed', () => {
    const error = new Error('first page failed');
    const { result } = renderListPage({
      dataSource: {
        type: 'paginated',
        results: [],
        status: 'Exhausted',
        loadMore: vi.fn(),
        isLoading: false,
        error,
        retry: vi.fn(),
      },
    });

    expect(result.current.tableProps.error).toBe(error);
  });

  it('reports no error for a healthy source', () => {
    const { result } = renderListPage();
    expect(result.current.tableProps.error).toBeNull();
    expect(result.current.tableProps.onRetry).toBeUndefined();
    expect(result.current.tableProps.infiniteScroll.loadFailed).toBe(false);
  });

  // #3777: a search drained into a page that failed, and the drain re-issued
  // it on every render while the table showed a skeleton no request filled.
  it('stops draining a paginated source a failed request halted', () => {
    const loadMore = vi.fn();
    const { result } = renderListPage({
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'CanLoadMore',
        loadMore,
        isLoading: false,
        error: new Error('next page failed'),
        retry: vi.fn(),
      },
      search: { fields: ['name'] },
    });

    act(() => {
      result.current.tableProps.search?.onChange('Item 99');
    });
    act(() => {
      result.current.tableProps.infiniteScroll.onLoadMore();
    });

    expect(loadMore).not.toHaveBeenCalled();
    // The rows stay, the error is not the table's (rows exist), and the
    // table learns that nothing is loading.
    expect(result.current.tableProps.error).toBeNull();
    expect(result.current.tableProps.infiniteScroll.loadFailed).toBe(true);
    expect(result.current.tableProps.infiniteScroll.hasMore).toBe(true);
  });

  it('opens its window to every loaded row once halted, and keeps it open', () => {
    const halted = {
      type: 'paginated' as const,
      results: makeItems(25),
      status: 'CanLoadMore' as const,
      loadMore: vi.fn(),
      isLoading: false,
      error: new Error('next page failed') as Error | null,
      retry: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ source }) =>
        useListPage<TestItem>({ dataSource: source, pageSize: 10 }),
      { initialProps: { source: halted } },
    );
    // No scroll pages loaded rows in while the list is halted.
    expect(result.current.tableProps.data).toHaveLength(25);

    // Recovered: the rows on screen stay on screen.
    rerender({ source: { ...halted, results: makeItems(35), error: null } });
    expect(result.current.tableProps.data).toHaveLength(25);
    expect(result.current.tableProps.infiniteScroll.loadFailed).toBe(false);
  });

  it('reads a retry in flight as loading again', () => {
    const { result } = renderListPage({
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'LoadingMore',
        loadMore: vi.fn(),
        isLoading: true,
        error: new Error('next page failed'),
        retry: vi.fn(),
      },
    });

    expect(result.current.tableProps.infiniteScroll.loadFailed).toBe(false);
  });
});
