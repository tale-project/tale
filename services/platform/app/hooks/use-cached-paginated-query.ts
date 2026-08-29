import type { ConvexReactClient } from 'convex/react';
import { getFunctionName, type OptionalRestArgs } from 'convex/server';
import { useCallback } from 'react';

import {
  useConvexPaginatedQuery,
  type PaginatedQueryArgs,
  type PaginatedQueryReference,
  type UsePaginatedQueryReturnType,
} from '@/app/hooks/use-convex-paginated-query';
import { useReactInfiniteQuery } from '@/app/hooks/use-react-query';
import {
  activeOrganizationId,
  PAGINATED_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
  type AdaptedPage,
  type AdaptedPaginatedOptions,
} from '@/app/lib/backend/convex-adapters';

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
/** The adapted HTTP lane: react-query `useInfiniteQuery` over the backend's
 * keyset cursors, presented in Convex's paginated-hook shape. Always called
 * (hook-order stability) — a non-adapted query passes `opts: null` and the
 * underlying query stays disabled. */
function useBackendPaginatedQuery<Query extends PaginatedQueryReference>(
  opts: AdaptedPaginatedOptions | null,
  options: { initialNumItems: number },
): UsePaginatedQueryReturnType<Query> {
  const fetchPage = opts?.fetchPage;
  const infinite = useReactInfiniteQuery<AdaptedPage>({
    queryKey: opts?.queryKey ?? ['backend', 'paginated', 'disabled'],
    enabled: fetchPage !== undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      if (fetchPage === undefined) {
        return Promise.reject(new Error('paginated adapter disabled'));
      }
      return runAdapted(() =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- react-query types pageParam as unknown; this lane only ever stores string|null cursors
        fetchPage(pageParam as string | null, options.initialNumItems),
      );
    },
    getNextPageParam: (last: AdaptedPage) =>
      last.isDone ? undefined : last.continueCursor,
    retry: retryAdaptedRead,
  });
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    data,
    isLoading,
    isError,
  } = infinite;
  const loadMore = useCallback(
    (_numItems: number) => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage],
  );
  const results = data?.pages.flatMap((page) => page.page) ?? [];
  // A failed first page reads as an exhausted empty list (never an eternal
  // skeleton) — the retry policy has already given up on a deterministic 4xx.
  const status =
    data === undefined
      ? isError
        ? 'Exhausted'
        : 'LoadingFirstPage'
      : isFetchingNextPage
        ? 'LoadingMore'
        : hasNextPage
          ? 'CanLoadMore'
          : 'Exhausted';
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapted page items match the 0.4 wire this Query declares; the status union is constructed exhaustively above
  return {
    results,
    status,
    isLoading: isLoading || isFetchingNextPage,
    loadMore,
  } as UsePaginatedQueryReturnType<Query>;
}

export function useCachedPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query> | 'skip',
  options: { initialNumItems: number },
): UsePaginatedQueryReturnType<Query> {
  // A family migrated to the 0.5 backend serves this listing over HTTP
  // (infinite query, keyset cursors); everything else keeps the Convex
  // subscription. Both hooks always run — one of them disabled — so hook
  // order never changes with the registry.
  const adapter = PAGINATED_ADAPTERS[getFunctionName(query)];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adaptedOpts =
    adapter !== undefined && args !== 'skip'
      ? adapter(args, organizationId !== undefined ? { organizationId } : {})
      : null;
  const adaptedResult = useBackendPaginatedQuery<Query>(adaptedOpts, options);
  const result = useConvexPaginatedQuery(
    query,
    adapter === undefined ? args : 'skip',
    options,
  );
  if (adapter !== undefined) {
    return adaptedResult;
  }
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
  // An adapted listing never reads this cache (react-query owns its pages) —
  // priming would fire a useless Convex query.
  if (PAGINATED_ADAPTERS[getFunctionName(query)] !== undefined) return;
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
