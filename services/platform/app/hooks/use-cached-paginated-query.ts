import { useCallback } from 'react';

import { useReactInfiniteQuery } from '@/app/hooks/use-react-query';
import {
  activeOrganizationId,
  PAGINATED_ADAPTERS,
  retryAdaptedRead,
  runAdapted,
  type AdaptedPage,
  type AdaptedPaginatedOptions,
} from '@/app/lib/backend/adapters';
import type {
  ArgsOf,
  PageItemOf,
  PaginatedName,
} from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';

/** How far a listing has walked. Kept as the 0.4 vocabulary because every
 *  consumer branches on these four words. */
export type PaginatedStatus =
  | 'LoadingFirstPage'
  | 'LoadingMore'
  | 'CanLoadMore'
  | 'Exhausted';

/** What a paginated listing hands its consumer. */
export interface UsePaginatedQueryReturnType<Item> {
  results: Item[];
  status: PaginatedStatus;
  isLoading: boolean;
  loadMore: (numItems: number) => void;
}

/** The listing lane: react-query `useInfiniteQuery` over the backend's keyset
 * cursors. Always called (hook-order stability) — a listing with no adapter
 * row passes `opts: null` and the underlying query stays disabled. */
function useBackendPaginatedQuery<Item>(
  opts: AdaptedPaginatedOptions | null,
  options: { initialNumItems: number },
): UsePaginatedQueryReturnType<Item> {
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
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter's page rows are the contract's page item by construction (both keyed by the same name)
    results: results as Item[],
    status,
    isLoading: isLoading || isFetchingNextPage,
    loadMore,
  };
}

/**
 * A paginated backend listing, addressed by its contract name. Results are
 * cached across unmount/remount, so re-navigation renders instantly instead
 * of flashing a skeleton. A name with no adapter row has no server left to
 * page through, so it fails loudly and named.
 */
export function useCachedPaginatedQuery<Name extends PaginatedName>(
  name: Name,
  args: Omit<ArgsOf<Name>, 'paginationOpts'> | 'skip',
  options: { initialNumItems: number },
): UsePaginatedQueryReturnType<PageItemOf<Name>> {
  const adapter = PAGINATED_ADAPTERS[name];
  const organizationId =
    adapter === undefined ? undefined : activeOrganizationId();
  const adaptedOpts =
    adapter !== undefined && args !== 'skip'
      ? adapter(args, organizationId !== undefined ? { organizationId } : {})
      : null;
  const adaptedResult = useBackendPaginatedQuery<PageItemOf<Name>>(
    adaptedOpts,
    options,
  );
  if (adapter === undefined && args !== 'skip') {
    throw new MissingBackendRowError(name);
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
export function primeCachedPaginatedQuery<Name extends PaginatedName>(
  _client: unknown,
  _name: Name,
  _args: Omit<ArgsOf<Name>, 'paginationOpts'>,
  _options: { initialNumItems: number },
): Promise<void> {
  return Promise.resolve();
}
