import { getFunctionName } from 'convex/server';
import { useCallback } from 'react';

import {
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
import { ConvexRetiredError } from '@/app/lib/backend/retired-convex';

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
  // Every shipped listing is served over HTTP (infinite query, keyset
  // cursors) by its adapter row. A listing with no row has no server left to
  // subscribe to, so it fails loudly and named rather than hanging.
  const fnName = getFunctionName(query);
  const adapter = PAGINATED_ADAPTERS[fnName];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adaptedOpts =
    adapter !== undefined && args !== 'skip'
      ? adapter(args, organizationId !== undefined ? { organizationId } : {})
      : null;
  const adaptedResult = useBackendPaginatedQuery<Query>(adaptedOpts, options);
  if (adapter === undefined && args !== 'skip') {
    throw new ConvexRetiredError(fnName);
  }
  return adaptedResult;
}

/**
 * Loader-side priming for a paginated listing.
 *
 * The adapted lane's pages live in react-query, whose own cache the route's
 * component reads on mount — so there is nothing left for a loader to warm
 * here. Kept as a no-op (rather than deleted at 20 call sites) so a listing
 * that later grows its own prefetch has one obvious place to grow it.
 */
export function primeCachedPaginatedQuery<
  Query extends PaginatedQueryReference,
>(
  _client: unknown,
  _query: Query,
  _args: PaginatedQueryArgs<Query>,
  _options: { initialNumItems: number },
): Promise<void> {
  return Promise.resolve();
}
