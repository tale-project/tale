'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQuery, usePreloadedQuery, type Preloaded } from 'convex/react';
import type { FunctionReference, FunctionArgs, FunctionReturnType } from 'convex/server';
import type { UseCursorPaginatedQueryReturn } from '@/lib/pagination/types';

/**
 * Configuration for cursor-paginated queries
 */
interface UseCursorPaginatedQueryOptions<
  TQuery extends FunctionReference<'query'>,
  TBaseArgs = Omit<FunctionArgs<TQuery>, 'cursor' | 'numItems'>,
> {
  /** The Convex query function reference */
  query: TQuery;
  /** Preloaded data from server component (optional) */
  preloadedData?: Preloaded<TQuery>;
  /** Base query arguments (cursor handled internally) */
  args: TBaseArgs;
  /** Number of items per page (default: 20) */
  numItems?: number;
  /** Initial cursor value (default: null for first page) */
  initialCursor?: string | null;
  /**
   * Transform args to build the final query arguments.
   * Use this when the API expects cursor/numItems in a different format
   * (e.g., wrapped in paginationOpts: { cursor, numItems }).
   * If not provided, cursor and numItems are added directly to args.
   */
  transformArgs?: (baseArgs: TBaseArgs, cursor: string | null, numItems: number) => FunctionArgs<TQuery>;
}

/**
 * Expected shape of cursor-paginated query results
 */
interface CursorPaginatedResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}

/**
 * Hook for cursor-based pagination with infinite scroll support.
 *
 * Features:
 * - Server-side preloading support (SSR)
 * - Automatic page accumulation for infinite scroll
 * - Real-time reactivity for first page (new items appear automatically)
 * - Load more functionality
 * - Reset to initial state
 * - Error state exposure for UI error handling
 *
 * @example
 * ```tsx
 * const { data, error, isError, isLoading, hasMore, loadMore, refetch } = useCursorPaginatedQuery({
 *   query: api.items.listItems,
 *   preloadedData,
 *   args: { organizationId },
 *   numItems: 20,
 * });
 *
 * if (isError && error) {
 *   return <ErrorDisplay error={error} onRetry={refetch} />;
 * }
 * ```
 */
export function useCursorPaginatedQuery<
  TQuery extends FunctionReference<'query'>,
  TItem = FunctionReturnType<TQuery> extends CursorPaginatedResult<infer I>
    ? I
    : unknown,
  TBaseArgs = Omit<FunctionArgs<TQuery>, 'cursor' | 'numItems'>,
>(
  options: UseCursorPaginatedQueryOptions<TQuery, TBaseArgs>,
): UseCursorPaginatedQueryReturn<TItem> {
  const { query, preloadedData, args, numItems = 20, initialCursor = null, transformArgs } = options;

  // Track loaded pages (excluding first page which is handled separately for reactivity)
  const [additionalPages, setAdditionalPages] = useState<TItem[][]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  /**
   * Error state for query failures.
   * Note: Convex's useQuery returns undefined for both loading and error states,
   * making it difficult to distinguish between them. Error state here is primarily
   * for parent components to manually set errors or for future error detection logic.
   * Actual error catching happens via ErrorBoundary wrapping the DataTable component.
   */
  const [error, setError] = useState<Error | null>(null);

  // Track if we've initialized from preloaded data
  const initializedRef = useRef(false);

  // Track args to detect changes and auto-reset
  const argsKeyRef = useRef<string>(JSON.stringify(args));
  const currentArgsKey = JSON.stringify(args);
  const [isArgsChangeLoading, setIsArgsChangeLoading] = useState(false);

  // Use preloaded data for initial render (SSR hydration)
  const preloadedResult = preloadedData
    ? (usePreloadedQuery(preloadedData) as CursorPaginatedResult<TItem> | null)
    : null;

  // Build query args for first page (always fetch for real-time reactivity)
  const firstPageArgs = useMemo(
    () => transformArgs
      ? transformArgs(args, initialCursor, numItems)
      : ({
        ...args,
        cursor: initialCursor,
        numItems,
      } as FunctionArgs<TQuery>),
    [args, initialCursor, numItems, transformArgs],
  );

  // Always fetch first page for real-time reactivity
  // This ensures new items appear immediately after mutations
  const firstPageResult = useQuery(query, firstPageArgs as any) as
    | CursorPaginatedResult<TItem>
    | undefined;

  // Build query args for loading more pages
  const loadMoreArgs = useMemo(
    () => nextCursor && transformArgs
      ? transformArgs(args, nextCursor, numItems)
      : nextCursor
        ? ({
          ...args,
          cursor: nextCursor,
          numItems,
        } as FunctionArgs<TQuery>)
        : null,
    [args, nextCursor, numItems, transformArgs],
  );

  // Fetch additional pages when loading more
  const loadMoreResult = useQuery(
    query,
    isLoadingMore && loadMoreArgs ? (loadMoreArgs as any) : 'skip',
  ) as CursorPaginatedResult<TItem> | undefined;

  // Auto-reset when args change (e.g., filters changed)
  useEffect(() => {
    if (currentArgsKey !== argsKeyRef.current) {
      argsKeyRef.current = currentArgsKey;
      initializedRef.current = false;
      setAdditionalPages([]);
      setNextCursor(null);
      setIsDone(false);
      setIsLoadingMore(false);
      setError(null); // Clear error on args change
      setIsArgsChangeLoading(true);
    }
  }, [currentArgsKey]);

  // Initialize from preloaded data or first page result
  useEffect(() => {
    const result = firstPageResult || preloadedResult;
    if (result && !initializedRef.current) {
      initializedRef.current = true;
      setIsDone(result.isDone);
      if (!result.isDone) {
        setNextCursor(result.continueCursor);
      }
      setError(null); // Clear any previous error
      setIsArgsChangeLoading(false);
    }
  }, [firstPageResult, preloadedResult]);

  // Handle load more results
  useEffect(() => {
    if (loadMoreResult && isLoadingMore) {
      setAdditionalPages((prev) => [...prev, loadMoreResult.page]);
      setIsDone(loadMoreResult.isDone);
      setIsLoadingMore(false);
      if (!loadMoreResult.isDone) {
        setNextCursor(loadMoreResult.continueCursor);
      }
    }
  }, [loadMoreResult, isLoadingMore]);

  // Combine first page (real-time) with additional loaded pages
  const data = useMemo(() => {
    const firstPage = firstPageResult?.page || preloadedResult?.page || [];
    return [...firstPage, ...additionalPages.flat()];
  }, [firstPageResult, preloadedResult, additionalPages]);

  // Loading state: true on initial load or when args changed
  const isLoading = !initializedRef.current || isArgsChangeLoading;

  // Has more items to load
  const hasMore = !isDone;

  // Load more items
  const loadMore = useCallback(() => {
    if (isDone || isLoadingMore || !nextCursor) return;
    setIsLoadingMore(true);
  }, [isDone, isLoadingMore, nextCursor]);

  // Reset to initial state
  const reset = useCallback(() => {
    initializedRef.current = false;
    setAdditionalPages([]);
    setNextCursor(null);
    setIsDone(false);
    setIsLoadingMore(false);
    setError(null);
  }, []);

  // Refetch is an alias for reset
  const refetch = reset;

  return {
    data,
    error,
    isError: error !== null,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    reset,
    refetch,
  };
}
