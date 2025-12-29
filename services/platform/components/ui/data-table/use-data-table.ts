'use client';

import { useMemo } from 'react';
import type { OnChangeFn } from '@tanstack/react-table';
import type {
  FilterDefinitions,
  ParsedFilters,
  UseUrlFiltersReturn,
  MultiSelectFilterDefinition,
  SortingState,
} from '@/lib/pagination/types';
import type { FilterConfig } from './data-table-filters';

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

export interface UseDataTableOptions<T extends FilterDefinitions> {
  /** URL filters return object from useUrlFilters */
  urlFilters: UseUrlFiltersReturn<T>;
  /** Translation function for label keys */
  t: (key: string) => string;
  /** Search configuration */
  search?: {
    /** Filter key for search (defaults to 'query') */
    key?: keyof T;
    /** Placeholder text */
    placeholder?: string;
    /** Width class for search input */
    className?: string;
  };
  /** Override options or labels for specific filters */
  filterOverrides?: Partial<Record<string, Partial<FilterConfig>>>;
}

export interface UseDataTableReturn {
  /** Search configuration for DataTable (undefined if no search filter) */
  searchConfig: DataTableSearchConfig | undefined;
  /** Filter configurations for DataTable */
  filterConfigs: FilterConfig[];
  /** Sorting configuration for DataTable (spread into DataTable props) */
  sortingConfig: DataTableSortingConfig;
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Clear all filters */
  clearAll: () => void;
  /** Whether URL update is pending */
  isPending: boolean;
}

/**
 * Combined hook for DataTable search, filter, and sorting configuration.
 *
 * Converts filter definitions from useUrlFilters into the format
 * expected by DataTable's props. Handles translations, state management,
 * and URL synchronization automatically.
 *
 * @example
 * ```tsx
 * function MyTable() {
 *   const { t } = useT('myNamespace');
 *   const urlFilters = useUrlFilters({
 *     filters: myFilterDefs,
 *     sorting: { defaultSort: 'createdAt', defaultDesc: true },
 *   });
 *
 *   const {
 *     searchConfig,
 *     filterConfigs,
 *     sortingConfig,
 *     clearAll,
 *     isPending,
 *   } = useDataTable({
 *     urlFilters,
 *     t,
 *     search: { placeholder: t('searchPlaceholder') },
 *   });
 *
 *   return (
 *     <DataTable
 *       columns={columns}
 *       data={data}
 *       sorting={sortingConfig}
 *       search={searchConfig}
 *       filters={filterConfigs}
 *       onClearFilters={clearAll}
 *       isFiltersLoading={isPending}
 *     />
 *   );
 * }
 * ```
 */
export function useDataTable<T extends FilterDefinitions>(
  options: UseDataTableOptions<T>,
): UseDataTableReturn {
  const { urlFilters, t, search, filterOverrides = {} } = options;

  // Build search config
  const searchConfig = useMemo((): DataTableSearchConfig | undefined => {
    const searchKey = (search?.key ?? 'query') as keyof T;
    const definition = urlFilters.definitions[searchKey];

    // Return undefined if no search filter is defined
    if (!definition || definition.type !== 'search') {
      return undefined;
    }

    const filters = urlFilters.filters as ParsedFilters<T>;
    const value = filters[searchKey] as string;

    return {
      value,
      onChange: (newValue: string) =>
        urlFilters.setFilter(searchKey, newValue as ParsedFilters<T>[typeof searchKey]),
      placeholder: search?.placeholder,
      className: search?.className,
    };
  }, [urlFilters, search]);

  // Build filter configs
  const filterConfigs = useMemo((): FilterConfig[] => {
    const result: FilterConfig[] = [];

    for (const [key, definition] of Object.entries(urlFilters.definitions)) {
      // Only process multiSelect filters (search is handled separately)
      if (definition.type !== 'multiSelect') continue;

      const multiSelectDef = definition as MultiSelectFilterDefinition;
      const filters = urlFilters.filters as ParsedFilters<T>;
      const selectedValues = (filters[key as keyof T] as string[]) || [];
      const override = filterOverrides[key];

      const config: FilterConfig = {
        key,
        title: override?.title ?? t(multiSelectDef.titleKey),
        options:
          override?.options ??
          multiSelectDef.options.map((opt) => ({
            value: opt.value,
            label: t(opt.labelKey),
          })),
        selectedValues,
        onChange: (values: string[]) => {
          urlFilters.setFilter(key as keyof T, values as ParsedFilters<T>[keyof T]);
        },
        grid: override?.grid ?? multiSelectDef.grid,
      };

      result.push(config);
    }

    return result;
  }, [urlFilters, t, filterOverrides]);

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
    filterConfigs,
    sortingConfig,
    hasActiveFilters: urlFilters.hasActiveFilters,
    clearAll: urlFilters.clearAll,
    isPending: urlFilters.isPending,
  };
}
