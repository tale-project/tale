import type {
  PaginatedQueryReference,
  UsePaginatedQueryReturnType,
} from 'convex/react';

import { usePaginatedQuery, type PaginatedQueryArgs } from 'convex/react';
import { getFunctionName } from 'convex/server';

interface CacheEntry {
  results: unknown[];
  wasExhausted: boolean;
}

const MAX_CACHE_ENTRIES = 50;
const paginatedQueryCache = new Map<string, CacheEntry>();

function buildCacheKey(query: PaginatedQueryReference, args: unknown): string {
  return `${getFunctionName(query)}:${JSON.stringify(args)}`;
}

/**
 * Drop-in replacement for `usePaginatedQuery` that caches results across
 * component unmount/remount cycles. On re-navigation the cached data is
 * returned instantly while the WebSocket subscription re-establishes,
 * eliminating the skeleton flash.
 */
export function useCachedPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query> | 'skip',
  options: { initialNumItems: number },
): UsePaginatedQueryReturnType<Query> {
  const result = usePaginatedQuery(query, args, options);
  const cacheKey = buildCacheKey(query, args);

  // Persist live results into cache (including empty results to avoid empty-list flash)
  if (result.status !== 'LoadingFirstPage') {
    paginatedQueryCache.delete(cacheKey);
    paginatedQueryCache.set(cacheKey, {
      results: result.results,
      wasExhausted: result.status === 'Exhausted',
    });
    if (paginatedQueryCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = paginatedQueryCache.keys().next().value;
      if (oldestKey) paginatedQueryCache.delete(oldestKey);
    }
  }

  // Serve cached data while first page loads
  if (result.status === 'LoadingFirstPage') {
    const cached = paginatedQueryCache.get(cacheKey);
    if (cached) {
      return cached.wasExhausted
        ? {
            results: cached.results,
            status: 'Exhausted',
            loadMore: result.loadMore,
            isLoading: false,
          }
        : {
            results: cached.results,
            status: 'CanLoadMore',
            loadMore: result.loadMore,
            isLoading: false,
          };
    }
  }

  return result;
}
