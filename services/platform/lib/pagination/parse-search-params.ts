/**
 * Server-side URL parsing utilities for pagination and filtering
 *
 * Used in Server Components to parse searchParams and pass to preloadQuery
 */

import {
  type FilterDefinitions,
  type ParsedFilters,
  type OffsetPaginationState,
  type SortingState,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from './types';

/**
 * Options for parseSearchParams
 */
export interface ParseSearchParamsOptions {
  /** Default page size */
  defaultPageSize?: number;
  /** Default sort column */
  defaultSort?: string;
  /** Default sort direction (true = desc, false = asc) */
  defaultDesc?: boolean;
}

/**
 * Parse search params into typed filter values, pagination state, and sorting state
 *
 * @example
 * ```ts
 * // In Server Component
 * const { filters, pagination, sorting } = parseSearchParams(
 *   searchParams,
 *   filterDefinitions,
 *   { defaultSort: '_creationTime', defaultDesc: true }
 * );
 *
 * const preloadedData = await preloadQuery(api.customers.getCustomers, {
 *   organizationId,
 *   ...filters,
 *   page: pagination.page,
 *   pageSize: pagination.pageSize,
 *   sortField: sorting[0]?.id,
 *   sortOrder: sorting[0]?.desc ? 'desc' : 'asc',
 * });
 * ```
 */
export function parseSearchParams<T extends FilterDefinitions>(
  searchParams: Record<string, string | string[] | undefined>,
  definitions: T,
  options?: ParseSearchParamsOptions,
): {
  filters: ParsedFilters<T>;
  pagination: OffsetPaginationState;
  sorting: SortingState;
} {
  const filters = {} as ParsedFilters<T>;

  for (const [key, definition] of Object.entries(definitions)) {
    const urlKey = definition.urlKey ?? key;
    const rawValue = searchParams[urlKey];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;

    switch (definition.type) {
      case 'search':
        (filters as Record<string, unknown>)[key] = value ?? '';
        break;

      case 'multiSelect':
        (filters as Record<string, unknown>)[key] = value
          ? value.split(',').filter(Boolean)
          : [];
        break;

      case 'singleSelect':
        (filters as Record<string, unknown>)[key] = value ?? definition.defaultValue;
        break;

      case 'dateRange': {
        const fromKey = `${urlKey}From`;
        const toKey = `${urlKey}To`;
        const fromValue = searchParams[fromKey];
        const toValue = searchParams[toKey];
        (filters as Record<string, unknown>)[key] = {
          from: Array.isArray(fromValue) ? fromValue[0] : fromValue,
          to: Array.isArray(toValue) ? toValue[0] : toValue,
        };
        break;
      }
    }
  }

  // Parse pagination
  const pageRaw = searchParams.page;
  const sizeRaw = searchParams.size;
  const pageValue = Array.isArray(pageRaw) ? pageRaw[0] : pageRaw;
  const sizeValue = Array.isArray(sizeRaw) ? sizeRaw[0] : sizeRaw;

  const pagination: OffsetPaginationState = {
    page: pageValue ? parseInt(pageValue, 10) : DEFAULT_PAGE,
    pageSize: sizeValue ? parseInt(sizeValue, 10) : (options?.defaultPageSize ?? DEFAULT_PAGE_SIZE),
  };

  // Ensure valid values
  if (isNaN(pagination.page) || pagination.page < 1) {
    pagination.page = DEFAULT_PAGE;
  }
  if (isNaN(pagination.pageSize) || pagination.pageSize < 1) {
    pagination.pageSize = options?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  }

  // Parse sorting
  const sortRaw = searchParams.sort;
  const sortOrderRaw = searchParams.sortOrder;
  const sortValue = Array.isArray(sortRaw) ? sortRaw[0] : sortRaw;
  const sortOrderValue = Array.isArray(sortOrderRaw) ? sortOrderRaw[0] : sortOrderRaw;

  let sorting: SortingState = [];

  if (sortValue) {
    // Use sort params from URL
    sorting = [{ id: sortValue, desc: sortOrderValue === 'desc' }];
  } else if (options?.defaultSort) {
    // Use default sort if no URL params
    sorting = [{ id: options.defaultSort, desc: options.defaultDesc ?? true }];
  }

  return { filters, pagination, sorting };
}

/**
 * Build query args for Convex from parsed filters
 *
 * @example
 * ```ts
 * const queryArgs = buildQueryArgs(filters, {
 *   query: 'searchTerm',
 *   status: 'status',
 *   source: 'source',
 * });
 * // Result: { searchTerm: 'foo', status: ['active'], source: ['manual'] }
 * ```
 */
export function buildQueryArgs<T extends FilterDefinitions>(
  filters: ParsedFilters<T>,
  mapping: Partial<Record<keyof T, string>>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  for (const [filterKey, argKey] of Object.entries(mapping)) {
    if (!argKey) continue;

    const value = filters[filterKey as keyof T];

    // Skip empty values
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    // Skip empty date ranges
    if (typeof value === 'object' && !Array.isArray(value)) {
      const dateRange = value as { from?: string; to?: string };
      if (!dateRange.from && !dateRange.to) {
        continue;
      }
    }

    args[argKey as string] = value;
  }

  return args;
}

/**
 * Check if any filters are active
 */
export function hasActiveFilters<T extends FilterDefinitions>(
  filters: ParsedFilters<T>,
  definitions: T,
): boolean {
  for (const [key, definition] of Object.entries(definitions)) {
    const value = filters[key as keyof T];

    switch (definition.type) {
      case 'search':
        if (value && (value as string).length > 0) return true;
        break;

      case 'multiSelect':
        if ((value as string[])?.length > 0) return true;
        break;

      case 'singleSelect':
        if (value && value !== definition.defaultValue) return true;
        break;

      case 'dateRange': {
        const dateRange = value as { from?: string; to?: string };
        if (dateRange?.from || dateRange?.to) return true;
        break;
      }
    }
  }

  return false;
}
