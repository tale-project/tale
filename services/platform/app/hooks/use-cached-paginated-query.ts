import type { ConvexReactClient } from 'convex/react';
import { getFunctionName, type OptionalRestArgs } from 'convex/server';

import {
  useConvexPaginatedQuery,
  type PaginatedQueryArgs,
  type PaginatedQueryReference,
  type UsePaginatedQueryReturnType,
} from '@/app/hooks/use-convex-paginated-query';

const MAX_CACHE_ENTRIES = 50;
const paginatedQueryCache = new Map();

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
  const result = useConvexPaginatedQuery(query, args, options);
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

/**
 * Prime {@link useCachedPaginatedQuery}'s cache from a route `loader` so the
 * first page paints instantly on the *first* navigation to a list — not just on
 * re-nav. Fetches page 0 once and writes it under the same cache key the hook
 * reads, sidestepping Convex `usePaginatedQuery`'s per-mount `paginationOpts.id`
 * (which makes a plain `convexQuery` loader prefetch miss the subscription).
 *
 * `args` MUST equal the hook's `queryArgs` (everything it passes besides
 * `initialNumItems`) so the key matches — pass the same leading args the
 * component will use (e.g. `{ organizationId }` for an unfiltered list). The
 * `numItems` is not part of the key, so it only sets how many rows paint
 * instantly before the live subscription fills the rest.
 *
 * Client-only (the cache and WS client are per-browser) and fire-and-forget:
 * always `void` it in a loader so a slow/failed prime never stalls the
 * transition. Skips the fetch when the key is already cached.
 */
export async function primeCachedPaginatedQuery<
  Query extends PaginatedQueryReference,
>(
  convexClient: ConvexReactClient,
  query: Query,
  args: PaginatedQueryArgs<Query>,
  options: { initialNumItems: number },
): Promise<void> {
  if (typeof window === 'undefined') return;
  const cacheKey = buildCacheKey(query, args);
  if (paginatedQueryCache.has(cacheKey)) return;
  try {
    // Convex's generic `OptionalRestArgs<Query>` is an unresolved conditional
    // type, so it can't see that spreading `PaginatedQueryArgs` (FunctionArgs
    // minus paginationOpts) back with paginationOpts reconstitutes the call
    // args — a third-party typing gap, so assert the reconstructed tuple.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generic OptionalRestArgs<Query> conditional can't be satisfied structurally; the reconstructed page-0 args are correct
    const queryArgs = [
      {
        ...args,
        paginationOpts: { numItems: options.initialNumItems, cursor: null },
      },
    ] as unknown as OptionalRestArgs<Query>;
    const result = await convexClient.query(query, ...queryArgs);
    paginatedQueryCache.set(cacheKey, {
      results: result.page,
      wasExhausted: result.isDone,
    });
    if (paginatedQueryCache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = paginatedQueryCache.keys().next().value;
      if (oldestKey) paginatedQueryCache.delete(oldestKey);
    }
  } catch (error) {
    console.warn('Failed to prime paginated query cache', error);
  }
}
