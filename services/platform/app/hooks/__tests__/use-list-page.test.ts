import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useListPage } from '../use-list-page';

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
});

// ---------------------------------------------------------------------------
// Tests — pagination mode
// ---------------------------------------------------------------------------

describe('useListPage — pagination mode', () => {
  it('returns all processed data for client-side pagination', () => {
    const { result } = renderListPage({ displayMode: 'pagination' });

    expect(result.current.tableProps.data).toHaveLength(50);
    expect('pagination' in result.current.tableProps).toBe(true);
  });

  it('includes correct pagination config', () => {
    const { result } = renderListPage({
      displayMode: 'pagination',
      pageSize: 25,
    });

    const props = result.current.tableProps;
    if ('pagination' in props) {
      expect(props.pagination.clientSide).toBe(true);
      expect(props.pagination.pageSize).toBe(25);
      expect(props.pagination.total).toBe(50);
    }
  });

  it('applies search filter and updates pagination total', () => {
    const { result } = renderListPage({
      displayMode: 'pagination',
      search: {
        fields: ['name'],
        placeholder: 'Search...',
      },
    });

    // Initially all items
    expect(result.current.tableProps.data).toHaveLength(50);

    // Trigger search via the search config
    const props = result.current.tableProps;
    if (props.search) {
      act(() => {
        props.search?.onChange('Item 1');
      });
    }

    // Should filter to items matching "Item 1" (Item 1, Item 10-19)
    const filtered = result.current.tableProps.data;
    expect(filtered.length).toBeLessThan(50);
    expect(filtered.length).toBeGreaterThan(0);

    if ('pagination' in result.current.tableProps) {
      expect(result.current.tableProps.pagination.total).toBe(filtered.length);
    }
  });

  it('eagerly loads more from paginated backend source', () => {
    const loadMore = vi.fn();

    renderListPage({
      displayMode: 'pagination',
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

  it('does not eagerly load when backend is exhausted', () => {
    const loadMore = vi.fn();

    renderListPage({
      displayMode: 'pagination',
      dataSource: {
        type: 'paginated',
        results: makeItems(10),
        status: 'Exhausted',
        loadMore,
        isLoading: false,
      },
    });

    expect(loadMore).not.toHaveBeenCalled();
  });
});
