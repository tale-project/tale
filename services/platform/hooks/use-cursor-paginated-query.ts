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
> {
  /** The Convex query function reference */
  query: TQuery;
  /** Preloaded data from server component (optional) */
  preloadedData?: Preloaded<TQuery>;
  /** Base query arguments (cursor handled internally) */
  args: Omit<FunctionArgs<TQuery>, 'cursor' | 'numItems'>;
  /** Number of items per page (default: 20) */
  numItems?: number;
  /** Initial cursor value (default: null for first page) */
  initialCursor?: string | null;
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
 * - Load more functionality
 * - Reset to initial state
 *
 * @example
 * ```tsx
 * const { data, isLoading, hasMore, loadMore, reset } = useCursorPaginatedQuery({
 *   query: api.items.listItems,
 *   preloadedData,
 *   args: { organizationId },
 *   numItems: 20,
 * });
 * ```
 */
export function useCursorPaginatedQuery<
  TQuery extends FunctionReference<'query'>,
  TItem = FunctionReturnType<TQuery> extends CursorPaginatedResult<infer I>
    ? I
    : unknown,
>(
  options: UseCursorPaginatedQueryOptions<TQuery>,
): UseCursorPaginatedQueryReturn<TItem> {
  const { query, preloadedData, args, numItems = 20, initialCursor = null } = options;

  // Track loaded pages and cursor state
  const [pages, setPages] = useState<TItem[][]>([]);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [isDone, setIsDone] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Track if we've initialized from preloaded data
  const initializedRef = useRef(false);

  // Track args to detect changes and auto-reset
  const argsKeyRef = useRef<string>(JSON.stringify(args));
  const currentArgsKey = JSON.stringify(args);
  const [isArgsChangeLoading, setIsArgsChangeLoading] = useState(false);

  // Use preloaded data for initial render (SSR)
  const preloadedResult = preloadedData
    ? (usePreloadedQuery(preloadedData) as CursorPaginatedResult<TItem> | null)
    : null;

  // Build query args for live data
  const queryArgs = useMemo(
    () => ({
      ...args,
      cursor,
      numItems,
    }),
    [args, cursor, numItems],
  );

  // Fetch live data when cursor changes (after initial page)
  // Use type assertion due to Convex's strict query arg typing
  const shouldFetch = cursor !== null || initializedRef.current;
  const liveResult = useQuery(query, shouldFetch ? (queryArgs as any) : 'skip') as
    | CursorPaginatedResult<TItem>
    | undefined;

  // Auto-reset when args change (e.g., filters changed)
  useEffect(() => {
    if (currentArgsKey !== argsKeyRef.current) {
      argsKeyRef.current = currentArgsKey;
      initializedRef.current = false;
      setPages([]);
      setCursor(initialCursor);
      setIsDone(false);
      setIsLoadingMore(false);
      setIsArgsChangeLoading(true);
    }
  }, [currentArgsKey, initialCursor]);

  // Initialize from preloaded data on first render
  useEffect(() => {
    if (preloadedResult && !initializedRef.current) {
      initializedRef.current = true;
      setPages([preloadedResult.page]);
      setIsDone(preloadedResult.isDone);
      if (!preloadedResult.isDone) {
        setCursor(preloadedResult.continueCursor);
      }
    }
  }, [preloadedResult]);

  // Handle live data updates (for load more)
  useEffect(() => {
    if (liveResult && initializedRef.current && cursor !== null) {
      setPages((prev) => [...prev, liveResult.page]);
      setIsDone(liveResult.isDone);
      setIsLoadingMore(false);
    }
  }, [liveResult, cursor]);

  // Handle live data after args change (fresh fetch)
  useEffect(() => {
    if (liveResult && isArgsChangeLoading) {
      initializedRef.current = true;
      setPages([liveResult.page]);
      setIsDone(liveResult.isDone);
      setIsArgsChangeLoading(false);
      if (!liveResult.isDone) {
        setCursor(liveResult.continueCursor);
      }
    }
  }, [liveResult, isArgsChangeLoading]);

  // Flatten all pages into a single array
  const data = useMemo(() => pages.flat(), [pages]);

  // Loading state: true on initial load (without preloaded data) or when args changed
  const isLoading = (!initializedRef.current && !preloadedResult) || isArgsChangeLoading;

  // Has more items to load
  const hasMore = !isDone;

  // Load more items
  const loadMore = useCallback(() => {
    if (isDone || isLoadingMore) return;

    if (liveResult && !liveResult.isDone) {
      setIsLoadingMore(true);
      setCursor(liveResult.continueCursor);
    }
  }, [isDone, isLoadingMore, liveResult]);

  // Reset to initial state
  const reset = useCallback(() => {
    initializedRef.current = false;
    setPages([]);
    setCursor(initialCursor);
    setIsDone(false);
    setIsLoadingMore(false);
  }, [initialCursor]);

  return {
    data,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    reset,
  };
}
