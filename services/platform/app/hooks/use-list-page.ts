'use client';

import { useState, useMemo, useCallback } from 'react';

import type { FilterConfig } from '@/app/components/ui/data-table/data-table-filters';
import type {
  DataTableSearchConfig,
  EntityLabel,
} from '@/app/components/ui/data-table/data-table-types';
import { filterByTextSearch, filterByFields } from '@/lib/utils/filtering';

// ---------------------------------------------------------------------------
// Data Source Types
// ---------------------------------------------------------------------------

interface PaginatedDataSource<TData> {
  type: 'paginated';
  results: TData[] | undefined;
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  loadMore: (numItems: number) => void;
  isLoading: boolean;
}

interface QueryDataSource<TData> {
  type: 'query';
  data: TData[] | undefined;
}

type DataSource<TData> = PaginatedDataSource<TData> | QueryDataSource<TData>;

// ---------------------------------------------------------------------------
// Filter Definition (for managed filters)
// ---------------------------------------------------------------------------

interface ListFilterDefinition {
  key: string;
  title: string;
  options: Array<{ value: string; label: string }>;
  grid?: boolean;
}

// ---------------------------------------------------------------------------
// Search Configuration
// ---------------------------------------------------------------------------

interface ManagedSearch<TData> {
  fields: (keyof TData & string)[];
  placeholder?: string;
}

interface ControlledSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Filter Configuration
// ---------------------------------------------------------------------------

interface ManagedFilters {
  definitions: ListFilterDefinition[];
}

interface ControlledFilters {
  configs: FilterConfig[];
  onClear: () => void;
}

// ---------------------------------------------------------------------------
// Hook Options
// ---------------------------------------------------------------------------

interface UseListPageOptions<TData> {
  dataSource: DataSource<TData>;
  pageSize: number;
  search?: ManagedSearch<TData> | ControlledSearch;
  filters?: ManagedFilters | ControlledFilters;
  getRowId?: (row: TData) => string;
  /** Approximate item count for skeleton row count during initial loading */
  approxRowCount?: number;
  /** Entity noun. Enables the "Showing all X {entity}" footer — pass `{ one, other }` so a single-row table reads correctly too. */
  entityLabel?: EntityLabel;
  /**
   * Entities a row represents in the footer count. A folder row aggregates
   * its members, so counting rows would count the folder as one entity
   * (#2348). Defaults to 1 per row; only affects the infinite-scroll entity
   * footer.
   */
  countRow?: (row: TData) => number;
  /**
   * Display mode for the table.
   * - `'infiniteScroll'` (default): renders an infinite-scroll list that loads more as the user scrolls.
   * - `'pagination'`: renders client-side pagination controls with next/previous navigation.
   */
  displayMode?: 'infiniteScroll' | 'pagination';
}

// ---------------------------------------------------------------------------
// Hook Return Type
// ---------------------------------------------------------------------------

interface ListPageInfiniteScrollTableProps<TData> {
  data: TData[];
  search?: DataTableSearchConfig;
  filters?: FilterConfig[];
  onClearFilters?: () => void;
  getRowId: (row: TData) => string;
  infiniteScroll: {
    hasMore: boolean;
    onLoadMore: () => void;
    isLoadingMore: boolean;
    isInitialLoading: boolean;
    entityLabel?: EntityLabel;
    /** Unfiltered total from rawData — differs from the shown count when filters are active */
    totalCount?: number;
    /** Entities the visible rows represent when rows aggregate (see `countRow`) */
    displayedCount?: number;
  };
  approxRowCount?: number;
}

interface ListPagePaginationTableProps<TData> {
  data: TData[];
  search?: DataTableSearchConfig;
  filters?: FilterConfig[];
  onClearFilters?: () => void;
  getRowId: (row: TData) => string;
  pagination: {
    clientSide: true;
    pageSize: number;
    total: number;
    showPageSizeSelector: boolean;
    entityLabel?: EntityLabel;
  };
  isLoading: boolean;
  approxRowCount?: number;
}

type ListPageTableProps<TData> =
  | ListPageInfiniteScrollTableProps<TData>
  | ListPagePaginationTableProps<TData>;

interface UseListPageReturn<TData> {
  tableProps: ListPageTableProps<TData>;
  processedData: TData[];
  totalCount: number;
  filteredCount: number;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

function isManagedSearch<TData>(
  search: ManagedSearch<TData> | ControlledSearch,
): search is ManagedSearch<TData> {
  return 'fields' in search;
}

function isControlledFilters(
  filters: ManagedFilters | ControlledFilters,
): filters is ControlledFilters {
  return 'configs' in filters;
}

/** Sums the entities the rows represent — 1 per row unless `countRow` says otherwise. */
function countEntities<TData>(
  rows: readonly TData[],
  countRow?: (row: TData) => number,
): number {
  if (!countRow) return rows.length;
  return rows.reduce((sum, row) => sum + countRow(row), 0);
}

// ---------------------------------------------------------------------------
// Hook Implementation
// ---------------------------------------------------------------------------

export function useListPage<TData>(
  options: UseListPageOptions<TData>,
): UseListPageReturn<TData> {
  const {
    dataSource,
    pageSize,
    search,
    filters,
    getRowId,
    approxRowCount,
    entityLabel,
    countRow,
    displayMode = 'infiniteScroll',
  } = options;

  // 1. Normalize data source
  const rawData = useMemo(
    () =>
      dataSource.type === 'paginated'
        ? (dataSource.results ?? [])
        : (dataSource.data ?? []),
    [dataSource],
  );

  const isLoading =
    dataSource.type === 'paginated'
      ? dataSource.status === 'LoadingFirstPage'
      : dataSource.data === undefined;

  // 2. Managed search state
  const [managedSearchValue, setManagedSearchValue] = useState('');

  // 3. Managed filter states (single object for all filters)
  const [managedFilterStates, setManagedFilterStates] = useState<
    Record<string, string[]>
  >({});

  // 4. Display count
  const [displayCount, setDisplayCount] = useState(pageSize);

  // Determine actual search value
  const searchValue =
    search && isManagedSearch(search) ? managedSearchValue : '';

  // Determine actual filter values (only for managed mode)
  const filterValues =
    filters && !isControlledFilters(filters) ? managedFilterStates : null;

  // Whether a client-side search/filter is currently narrowing the dataset.
  // When true in infinite-scroll mode we must eagerly drain ALL backend pages
  // so the filter scans the full dataset rather than only already-loaded pages
  // (#2054) — otherwise a match on an un-loaded page is silently missed.
  const hasActiveClientFilter = useMemo(() => {
    const searchActive = search
      ? isManagedSearch(search)
        ? managedSearchValue.trim().length > 0
        : search.value.trim().length > 0
      : false;
    const managedFilterActive = filterValues
      ? Object.values(filterValues).some((values) => values.length > 0)
      : false;
    return searchActive || managedFilterActive;
  }, [search, managedSearchValue, filterValues]);

  // 5. Process data (search + filters)
  const processed = useMemo(() => {
    let data = [...rawData];

    // Apply managed text search
    if (search && isManagedSearch<TData>(search) && searchValue) {
      data = filterByTextSearch(
        data,
        searchValue,
        search.fields as (keyof TData)[],
      );
    }

    // Apply managed field filters
    if (filterValues) {
      const activeFilters = Object.entries(filterValues)
        .filter(([, values]) => values.length > 0)
        .map(([field, values]) => ({
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries loses key type; field is keyof TData from filter definitions
          field: field as keyof TData,
          values: new Set(values),
        }));

      if (activeFilters.length > 0) {
        data = filterByFields(data, activeFilters);
      }
    }

    return data;
  }, [rawData, searchValue, filterValues, search]);

  // 6. Slice for display
  const displayed = useMemo(
    () => processed.slice(0, displayCount),
    [processed, displayCount],
  );

  // 7. Compute hasMore
  const hasMore =
    dataSource.type === 'paginated'
      ? displayCount < processed.length ||
        dataSource.status === 'CanLoadMore' ||
        dataSource.status === 'LoadingMore'
      : displayCount < processed.length;

  // 8. Reset displayCount helper
  const resetDisplayCount = useCallback(() => {
    setDisplayCount(pageSize);
  }, [pageSize]);

  // 9. handleLoadMore — prefetch from backend before buffer is exhausted
  const handleLoadMore = useCallback(() => {
    if (dataSource.type === 'paginated') {
      const nextDisplayCount = displayCount + pageSize;
      const remainingAfterIncrement = processed.length - nextDisplayCount;
      if (
        remainingAfterIncrement <= pageSize &&
        dataSource.status === 'CanLoadMore'
      ) {
        dataSource.loadMore(pageSize * 3);
      }
    }
    setDisplayCount((prev) => prev + pageSize);
  }, [dataSource, displayCount, processed.length, pageSize]);

  // 10. Build search config
  const searchConfig = useMemo((): DataTableSearchConfig | undefined => {
    if (!search) return undefined;

    if (isManagedSearch<TData>(search)) {
      return {
        value: managedSearchValue,
        onChange: (value: string) => {
          setManagedSearchValue(value);
          resetDisplayCount();
        },
        placeholder: search.placeholder,
      };
    }

    return {
      value: search.value,
      onChange: (value: string) => {
        search.onChange(value);
        resetDisplayCount();
      },
      placeholder: search.placeholder,
    };
  }, [search, managedSearchValue, resetDisplayCount]);

  // 11. Build filter configs
  const filterConfigs = useMemo((): FilterConfig[] | undefined => {
    if (!filters) return undefined;

    if (isControlledFilters(filters)) {
      return filters.configs;
    }

    return filters.definitions.map((def) => ({
      key: def.key,
      title: def.title,
      options: def.options,
      grid: def.grid,
      selectedValues: managedFilterStates[def.key] ?? [],
      onChange: (values: string[]) => {
        setManagedFilterStates((prev) => ({ ...prev, [def.key]: values }));
        resetDisplayCount();
      },
    }));
  }, [filters, managedFilterStates, resetDisplayCount]);

  // 12. Build clearAll
  const clearAll = useCallback(() => {
    if (search && isManagedSearch(search)) {
      setManagedSearchValue('');
    }
    if (filters && !isControlledFilters(filters)) {
      setManagedFilterStates({});
    }
    if (filters && isControlledFilters(filters)) {
      filters.onClear();
    }
    resetDisplayCount();
  }, [search, filters, resetDisplayCount]);

  // 13. Determine onClearFilters
  const onClearFilters =
    filters || (search && isManagedSearch(search)) ? clearAll : undefined;

  // 14. Build getRowId
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex documents always have _id; TData generic doesn't enforce it
  const rowIdFn = getRowId ?? ((row: TData) => (row as { _id: string })._id);

  const sharedTableProps = {
    search: searchConfig,
    filters: filterConfigs,
    onClearFilters,
    getRowId: rowIdFn,
    approxRowCount,
  };

  if (displayMode === 'pagination') {
    // In pagination mode, eagerly load all backend pages and let TanStack Table paginate client-side
    if (
      dataSource.type === 'paginated' &&
      dataSource.status === 'CanLoadMore'
    ) {
      dataSource.loadMore(pageSize * 3);
    }

    return {
      tableProps: {
        ...sharedTableProps,
        data: processed,
        pagination: {
          clientSide: true,
          pageSize,
          total: processed.length,
          showPageSizeSelector: false,
          entityLabel,
        },
        isLoading,
      },
      processedData: processed,
      totalCount: rawData.length,
      filteredCount: processed.length,
      isLoading,
    };
  }

  // Infinite-scroll mode normally fetches the next backend page only as the user
  // scrolls. But while a client-side search/filter is active we eagerly drain
  // the remaining pages so the filter scans the entire dataset — without this,
  // matches on un-loaded pages are silently missed, and a filter that narrows
  // the loaded buffer to zero suppresses the scroll sentinel, stranding the user
  // on a false "no results" (#2054).
  if (
    hasActiveClientFilter &&
    dataSource.type === 'paginated' &&
    dataSource.status === 'CanLoadMore'
  ) {
    dataSource.loadMore(pageSize * 3);
  }

  return {
    tableProps: {
      ...sharedTableProps,
      data: displayed,
      infiniteScroll: {
        hasMore,
        onLoadMore: handleLoadMore,
        isLoadingMore:
          dataSource.type === 'paginated'
            ? dataSource.status === 'LoadingMore' &&
              displayCount >= processed.length
            : false,
        isInitialLoading:
          dataSource.type === 'paginated'
            ? dataSource.status === 'LoadingFirstPage'
            : dataSource.data === undefined,
        entityLabel,
        // In entity units when rows aggregate (countRow) — a folder row stands
        // in for its members, so summing per-row counts keeps the footer's
        // numerator and denominator in the unit the entity label names (#2348).
        totalCount: entityLabel ? countEntities(rawData, countRow) : undefined,
        displayedCount: countRow
          ? countEntities(displayed, countRow)
          : undefined,
      },
    },
    processedData: processed,
    totalCount: rawData.length,
    filteredCount: processed.length,
    isLoading,
  };
}

export type { UseListPageOptions, UseListPageReturn };
