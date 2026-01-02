'use client';

/**
 * Hook for offset-based paginated queries with SSR support
 *
 * Features:
 * - Uses preloaded data from Server Component for initial render (SSR)
 * - Switches to live query when filters change (real-time updates)
 * - Memoized query args to prevent unnecessary re-renders
 * - Automatic loading state management
 */

import { usePreloadedQuery, useQuery, type Preloaded } from 'convex/react';
import { useMemo, useRef } from 'react';
import type { FunctionReference, FunctionArgs, FunctionReturnType } from 'convex/server';
import type { UseUrlFiltersReturn } from '@/lib/pagination/types';

export interface UseOffsetPaginatedQueryOptions<
  TQuery extends FunctionReference<'query'>,
  TFiltersReturn extends UseUrlFiltersReturn<any>,
> {
  /** The Convex query function reference */
  query: TQuery;
  /** Preloaded data from Server Component */
  preloadedData: Preloaded<TQuery>;
  /** Organization ID for multi-tenant queries */
  organizationId: string;
  /** Filters from useUrlFilters hook */
  filters: TFiltersReturn;
  /**
   * Transform filter state to query arguments
   *
   * @example
   * ```ts
   * transformFilters: (f) => ({
   *   searchTerm: f.query || undefined,
   *   status: f.status.length > 0 ? f.status : undefined,
   *   source: f.source.length > 0 ? f.source : undefined,
   * })
   * ```
   */
  transformFilters: (
    filters: TFiltersReturn['filters'],
  ) => Omit<
    FunctionArgs<TQuery>,
    'organizationId' | 'page' | 'pageSize' | 'currentPage' | 'paginationOpts'
  >;
}

/**
 * Hook for offset-based paginated queries
 *
 * @example
 * ```tsx
 * const { data, isLoading, pagination } = useOffsetPaginatedQuery({
 *   query: api.customers.getCustomers,
 *   preloadedData,
 *   organizationId,
 *   filters,
 *   transformFilters: (f) => ({
 *     searchTerm: f.query || undefined,
 *     status: f.status.length > 0 ? f.status : undefined,
 *   }),
 * });
 * ```
 */
export function useOffsetPaginatedQuery<
  TQuery extends FunctionReference<'query'>,
  TFiltersReturn extends UseUrlFiltersReturn<any>,
>({
  query,
  preloadedData,
  organizationId,
  filters,
  transformFilters,
}: UseOffsetPaginatedQueryOptions<TQuery, TFiltersReturn>): {
  data: FunctionReturnType<TQuery>;
  isLoading: boolean;
} {
  // Use preloaded data for initial render (SSR)
  const preloadedResult = usePreloadedQuery(preloadedData);

  // Build query args from current filter/pagination state
  const queryArgs = useMemo(() => {
    const transformed = transformFilters(filters.filters);

    return {
      organizationId,
      ...transformed,
      currentPage: filters.pagination.page,
      pageSize: filters.pagination.pageSize,
    } as FunctionArgs<TQuery>;
  }, [organizationId, filters.filters, filters.pagination, transformFilters]);

  // Track initial args to detect when we need to switch to live query
  const initialArgsRef = useRef<string | null>(null);
  if (initialArgsRef.current === null) {
    initialArgsRef.current = JSON.stringify(queryArgs);
  }

  // Determine if filters/pagination have changed from initial state
  const hasChangedFromInitial = useMemo(() => {
    return JSON.stringify(queryArgs) !== initialArgsRef.current;
  }, [queryArgs]);

  // Track which queryArgs key we're currently waiting for
  const currentArgsKey = JSON.stringify(queryArgs);
  const pendingArgsKeyRef = useRef<string | null>(null);

  // Use live query when filters change (skip on initial render to use preloaded data)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveResult = useQuery(query, hasChangedFromInitial ? queryArgs : ('skip' as any));

  // When args change, mark as pending until we get a result
  if (hasChangedFromInitial && pendingArgsKeyRef.current !== currentArgsKey) {
    pendingArgsKeyRef.current = currentArgsKey;
  }

  // When we get a live result, clear the pending state for current args
  if (liveResult !== undefined && pendingArgsKeyRef.current === currentArgsKey) {
    pendingArgsKeyRef.current = null;
  }

  // Return live data if available, otherwise preloaded data
  const data = (hasChangedFromInitial && liveResult !== undefined
    ? liveResult
    : preloadedResult) as FunctionReturnType<TQuery>;

  // Loading state: true when we have pending args waiting for data
  const isLoading = pendingArgsKeyRef.current !== null;

  return {
    data,
    isLoading,
  };
}
