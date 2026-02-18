'use client';

import type { OnChangeFn } from '@tanstack/react-table';

import { useMemo } from 'react';

import type {
  FilterDefinitions,
  ParsedFilters,
  UseUrlFiltersReturn,
  SortingState,
} from '@/lib/pagination/types';

export interface DataTableSearchConfig {
  /** Current search value */
  value: string;
  /** Callback when search changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Width class for the search input */
  className?: string;
}

export interface DataTableSortingConfig {
  /** Current sorting state (synced with URL) */
  initialSorting: SortingState;
  /** Callback when sorting changes (updates URL) */
  onSortingChange: OnChangeFn<SortingState>;
}

interface UseDataTableOptions<T extends FilterDefinitions> {
  /** URL filters return object from useUrlFilters */
  urlFilters: UseUrlFiltersReturn<T>;
  /** Search configuration */
  search?: {
    /** Filter key for search (defaults to 'query') */
    key?: keyof T;
    /** Placeholder text */
    placeholder?: string;
    /** Width class for search input */
    className?: string;
  };
}

interface UseDataTableReturn {
  /** Search configuration for DataTable (undefined if no search filter) */
  searchConfig: DataTableSearchConfig | undefined;
  /** Sorting configuration for DataTable (spread into DataTable props) */
  sortingConfig: DataTableSortingConfig;
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Clear all filters */
  clearAll: () => void;
  /** Whether URL update is pending */
  isPending: boolean;
}

export function useDataTable<T extends FilterDefinitions>(
  options: UseDataTableOptions<T>,
): UseDataTableReturn {
  const { urlFilters, search } = options;

  // Build search config
  const searchConfig = useMemo((): DataTableSearchConfig | undefined => {
    const searchKey = (search?.key ?? 'query') as keyof T;
    const definition = urlFilters.definitions[searchKey];

    // Return undefined if no search filter is defined
    if (!definition || definition.type !== 'search') {
      return undefined;
    }

    const filters = urlFilters.filters;
    const rawValue = filters[searchKey];
    const value = typeof rawValue === 'string' ? rawValue : '';

    return {
      value,
      onChange: (newValue: string) =>
        urlFilters.setFilter(
          searchKey,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Search filter is always a string value
          newValue as ParsedFilters<T>[typeof searchKey],
        ),
      placeholder: search?.placeholder,
      className: search?.className,
    };
  }, [urlFilters, search]);

  // Build sorting config
  const sortingConfig = useMemo(
    (): DataTableSortingConfig => ({
      initialSorting: urlFilters.sorting,
      onSortingChange: urlFilters.setSorting,
    }),
    [urlFilters.sorting, urlFilters.setSorting],
  );

  return {
    searchConfig,
    sortingConfig,
    hasActiveFilters: urlFilters.hasActiveFilters,
    clearAll: urlFilters.clearAll,
    isPending: urlFilters.isPending,
  };
}
