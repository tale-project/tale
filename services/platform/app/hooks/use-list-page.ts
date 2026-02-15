'use client';

import { useState, useMemo, useCallback } from 'react';

import type { FilterConfig } from '@/app/components/ui/data-table/data-table-filters';
import type { DataTableSearchConfig } from '@/app/components/ui/data-table/data-table-types';

import { filterByTextSearch, filterByFields } from '@/lib/utils/client-utils';

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
}

// ---------------------------------------------------------------------------
// Hook Return Type
// ---------------------------------------------------------------------------

interface ListPageTableProps<TData> {
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
  };
}

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

// ---------------------------------------------------------------------------
// Hook Implementation
// ---------------------------------------------------------------------------

export function useListPage<TData>(
  options: UseListPageOptions<TData>,
): UseListPageReturn<TData> {
  const { dataSource, pageSize, search, filters, getRowId } = options;

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

  return {
    tableProps: {
      data: displayed,
      search: searchConfig,
      filters: filterConfigs,
      onClearFilters,
      getRowId: rowIdFn,
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
            : false,
      },
    },
    processedData: processed,
    totalCount: rawData.length,
    filteredCount: processed.length,
    isLoading,
  };
}

export type { UseListPageOptions, UseListPageReturn };
