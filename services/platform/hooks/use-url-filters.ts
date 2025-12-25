'use client';

/**
 * Unified URL-based filter and pagination state management hook
 *
 * Features:
 * - Generic filter definitions support (search, multiSelect, singleSelect, dateRange)
 * - URL state persistence for bookmarkability
 * - useTransition for non-blocking URL updates
 * - Automatic page reset when filters change
 * - Debounced search input support
 */

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo, useTransition, useState, useEffect } from 'react';
import {
  type FilterDefinitions,
  type ParsedFilters,
  type ParsedFilterValue,
  type UseUrlFiltersReturn,
  type OffsetPaginationState,
  type SortingState,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_DEBOUNCE_MS,
} from '@/lib/pagination/types';

export interface UseUrlFiltersOptions<T extends FilterDefinitions> {
  /** Filter definitions */
  filters: T;
  /** Pagination configuration */
  pagination?: {
    defaultPageSize?: number;
  };
  /** Sorting configuration */
  sorting?: {
    /** Default sort column */
    defaultSort?: string;
    /** Default sort direction (true = desc, false = asc) */
    defaultDesc?: boolean;
  };
}

/**
 * Hook for managing URL-synced filter and pagination state
 *
 * @example
 * ```tsx
 * const filterDefs = {
 *   query: { type: 'search' as const, debounceMs: 300 },
 *   status: {
 *     type: 'multiSelect' as const,
 *     titleKey: 'filters.status',
 *     options: [
 *       { value: 'active', labelKey: 'status.active' },
 *       { value: 'churned', labelKey: 'status.churned' },
 *     ],
 *   },
 * } as const;
 *
 * function MyTable() {
 *   const { filters, setFilter, pagination, setPage, clearAll, isPending } =
 *     useUrlFilters({ filters: filterDefs });
 *
 *   // filters.query is string
 *   // filters.status is string[]
 *   // setFilter('status', ['active', 'churned'])
 * }
 * ```
 */
export function useUrlFilters<T extends FilterDefinitions>(
  options: UseUrlFiltersOptions<T>,
): UseUrlFiltersReturn<T> {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  // Parse current filter state from URL
  const parsedFilters = useMemo(() => {
    const result = {} as ParsedFilters<T>;

    for (const [key, definition] of Object.entries(options.filters)) {
      const urlKey = definition.urlKey ?? key;
      const rawValue = searchParams.get(urlKey);

      switch (definition.type) {
        case 'search':
          (result as Record<string, unknown>)[key] = rawValue ?? '';
          break;

        case 'multiSelect':
          (result as Record<string, unknown>)[key] = rawValue
            ? rawValue.split(',').filter(Boolean)
            : [];
          break;

        case 'singleSelect':
          (result as Record<string, unknown>)[key] = rawValue ?? definition.defaultValue;
          break;

        case 'dateRange': {
          const fromKey = `${urlKey}From`;
          const toKey = `${urlKey}To`;
          (result as Record<string, unknown>)[key] = {
            from: searchParams.get(fromKey) ?? undefined,
            to: searchParams.get(toKey) ?? undefined,
          };
          break;
        }
      }
    }

    return result;
  }, [searchParams, options.filters]);

  // Parse pagination from URL
  const pagination = useMemo<OffsetPaginationState>(() => {
    const page = parseInt(searchParams.get('page') ?? '', 10);
    const pageSize = parseInt(searchParams.get('size') ?? '', 10);

    return {
      page: isNaN(page) || page < 1 ? DEFAULT_PAGE : page,
      pageSize:
        isNaN(pageSize) || pageSize < 1
          ? (options.pagination?.defaultPageSize ?? DEFAULT_PAGE_SIZE)
          : pageSize,
    };
  }, [searchParams, options.pagination?.defaultPageSize]);

  // Parse sorting from URL
  const sorting = useMemo<SortingState>(() => {
    const sortParam = searchParams.get('sort');
    const sortOrderParam = searchParams.get('sortOrder');

    // If no sort param in URL, use default if provided
    if (!sortParam) {
      if (options.sorting?.defaultSort) {
        return [{ id: options.sorting.defaultSort, desc: options.sorting.defaultDesc ?? true }];
      }
      return [];
    }

    return [{ id: sortParam, desc: sortOrderParam === 'desc' }];
  }, [searchParams, options.sorting?.defaultSort, options.sorting?.defaultDesc]);

  // Local state for debounced search
  const searchFilterKey = useMemo(() => {
    const entry = Object.entries(options.filters).find(([, def]) => def.type === 'search');
    return entry ? entry[0] : null;
  }, [options.filters]);

  const searchDefinition = searchFilterKey
    ? options.filters[searchFilterKey]
    : null;

  const [localSearchValue, setLocalSearchValue] = useState(
    searchFilterKey ? (parsedFilters[searchFilterKey as keyof T] as string) : '',
  );

  // Sync local search state with URL when URL changes externally
  useEffect(() => {
    if (searchFilterKey) {
      setLocalSearchValue(parsedFilters[searchFilterKey as keyof T] as string);
    }
  }, [parsedFilters, searchFilterKey]);

  // Debounced search update
  useEffect(() => {
    if (!searchFilterKey || !searchDefinition) return;

    const urlValue = parsedFilters[searchFilterKey as keyof T] as string;
    if (localSearchValue === urlValue) return;

    const debounceMs =
      searchDefinition.type === 'search'
        ? (searchDefinition.debounceMs ?? DEFAULT_DEBOUNCE_MS)
        : DEFAULT_DEBOUNCE_MS;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const urlKey = searchDefinition.urlKey ?? searchFilterKey;

      // Reset to page 1 when search changes
      params.delete('page');

      if (localSearchValue) {
        params.set(urlKey, localSearchValue);
      } else {
        params.delete(urlKey);
      }

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [
    localSearchValue,
    searchFilterKey,
    searchDefinition,
    parsedFilters,
    searchParams,
    pathname,
    router,
  ]);

  // Update a single filter
  const setFilter = useCallback(
    <K extends keyof T>(key: K, value: ParsedFilterValue<T[K]>) => {
      const definition = options.filters[key];
      const urlKey = definition.urlKey ?? String(key);

      // Handle search filter with local state for debouncing
      if (definition.type === 'search') {
        setLocalSearchValue(value as string);
        return;
      }

      const params = new URLSearchParams(searchParams.toString());

      // Reset to page 1 when filters change
      params.delete('page');

      if (definition.type === 'multiSelect') {
        const arr = value as string[];
        if (arr.length > 0) {
          params.set(urlKey, arr.join(','));
        } else {
          params.delete(urlKey);
        }
      } else if (definition.type === 'dateRange') {
        const range = value as { from?: string; to?: string };
        if (range.from) {
          params.set(`${urlKey}From`, range.from);
        } else {
          params.delete(`${urlKey}From`);
        }
        if (range.to) {
          params.set(`${urlKey}To`, range.to);
        } else {
          params.delete(`${urlKey}To`);
        }
      } else if (definition.type === 'singleSelect') {
        if (value && value !== definition.defaultValue) {
          params.set(urlKey, String(value));
        } else {
          params.delete(urlKey);
        }
      }

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [options.filters, searchParams, pathname, router],
  );

  // Set page number
  const setPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (page > 1) {
        params.set('page', String(page));
      } else {
        params.delete('page');
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, pathname, router],
  );

  // Set page size
  const setPageSize = useCallback(
    (size: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('size', String(size));
      params.delete('page'); // Reset to page 1
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, pathname, router],
  );

  // Set sorting (TanStack Table compatible)
  const setSorting = useCallback(
    (sortingOrUpdater: SortingState | ((prev: SortingState) => SortingState)) => {
      const newSorting =
        typeof sortingOrUpdater === 'function'
          ? sortingOrUpdater(sorting)
          : sortingOrUpdater;

      const params = new URLSearchParams(searchParams.toString());

      // Reset to page 1 when sorting changes
      params.delete('page');

      if (newSorting.length > 0) {
        const { id, desc } = newSorting[0];
        // Only set URL params if different from defaults
        const isDefault =
          options.sorting?.defaultSort === id &&
          (options.sorting?.defaultDesc ?? true) === desc;

        if (isDefault) {
          params.delete('sort');
          params.delete('sortOrder');
        } else {
          params.set('sort', id);
          params.set('sortOrder', desc ? 'desc' : 'asc');
        }
      } else {
        params.delete('sort');
        params.delete('sortOrder');
      }

      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [searchParams, pathname, router, sorting, options.sorting],
  );

  // Clear all filters and reset pagination
  const clearAll = useCallback(() => {
    // Reset local search state
    setLocalSearchValue('');

    startTransition(() => {
      router.push(pathname, { scroll: false });
    });
  }, [pathname, router]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    // Check local search value for immediate feedback
    if (searchFilterKey && localSearchValue) return true;

    for (const [key, definition] of Object.entries(options.filters)) {
      // Skip search filter (already checked local value)
      if (definition.type === 'search') continue;

      const value = parsedFilters[key as keyof T];

      switch (definition.type) {
        case 'multiSelect':
          if ((value as string[])?.length > 0) return true;
          break;

        case 'singleSelect':
          if (value && value !== definition.defaultValue) return true;
          break;

        case 'dateRange': {
          const range = value as { from?: string; to?: string };
          if (range?.from || range?.to) return true;
          break;
        }
      }
    }

    return false;
  }, [options.filters, parsedFilters, searchFilterKey, localSearchValue]);

  // Return filters with local search value for immediate UI feedback
  const filtersWithLocalSearch = useMemo(() => {
    if (!searchFilterKey) return parsedFilters;

    return {
      ...parsedFilters,
      [searchFilterKey]: localSearchValue,
    } as ParsedFilters<T>;
  }, [parsedFilters, searchFilterKey, localSearchValue]);

  return {
    filters: filtersWithLocalSearch,
    definitions: options.filters,
    pagination,
    sorting,
    setFilter,
    setPage,
    setPageSize,
    setSorting,
    clearAll,
    hasActiveFilters,
    isPending,
  };
}

export type { UseUrlFiltersReturn } from '@/lib/pagination/types';
