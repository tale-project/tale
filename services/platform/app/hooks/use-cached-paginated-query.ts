import { useCallback, useMemo } from 'react';

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
import { readStateOf } from '@/app/lib/backend/read-state';

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
  /** The request's error once the retry policy gave up, else `null` — a
   * list hands it to `useListPage` so a failed read is never an empty list. */
  error: Error | null;
  /** Re-issue the request that failed: the first page, or the next one. */
  retry: () => void;
  /** A request is in flight again after a failure — a retry, or a refresh —
   * while the failure still stands, for a listing that never answered too. */
  isRetrying: boolean;
  /** The listing never answered and its last attempt failed; a retry may be
   * running. `error` is `null` while one does — react-query resets such a
   * read to its first-load state — and this holds still until it settles. */
  unavailable: boolean;
  /** How many times a request has settled in error: a notice keyed on it
   * appears afresh, and is announced again, for each new failure. */
  errorCount: number;
}

/** One empty listing for every read without pages, so a consumer's memo of
 *  the rows holds while nothing has loaded. */
const NO_RESULTS: never[] = [];

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
  // `isFetching` is left out on purpose: react-query re-renders a consumer
  // only for the properties it read, and a list that read it re-rendered on
  // the start and the end of every refetch a live hint caused. It is read
  // below only while the listing is failing, where it says a retry runs.
  const {
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    data,
    isLoading,
    isError,
    error,
    errorUpdateCount,
    refetch,
  } = infinite;
  // A next page that failed is not asked for again by scrolling or by a
  // search draining the list — both call this on every render, which would
  // re-issue the failing request in a loop. `retry` is the way on.
  const loadMore = useCallback(
    (_numItems: number) => {
      if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
        void fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError],
  );
  // The same array until the pages change: react-query keeps `data` when a
  // refetch answers the same rows, so the rows' memos downstream hold.
  const results = useMemo(
    () => data?.pages.flatMap((page) => page.page) ?? NO_RESULTS,
    [data],
  );
  // A failed first page reads as an exhausted empty list (never an eternal
  // skeleton) — the retry policy has already given up on a deterministic 4xx.
  // Asking for it again clears the error, so it loads like the first time.
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
  // The failed request, not a reload: a refetch reloads only the pages
  // already there, so a page that failed after them would never be asked for.
  const retry = useCallback(() => {
    if (isFetchNextPageError) void fetchNextPage();
    else void refetch();
  }, [isFetchNextPageError, fetchNextPage, refetch]);
  const failing =
    (data === undefined && errorUpdateCount > 0) ||
    (data !== undefined && isError);
  const read = readStateOf({
    data,
    isError,
    isFetching: failing && infinite.isFetching,
    errorUpdateCount,
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapter's page rows are the contract's page item by construction (both keyed by the same name)
    results: results as Item[],
    status,
    isLoading: isLoading || isFetchingNextPage,
    loadMore,
    // A failed request is the list's to show, never to pass off as an empty
    // collection: with no page loaded the table renders the error and its
    // retry; with pages loaded the rows stay and a later refetch heals it.
    error: isError ? (error ?? new Error('request failed')) : null,
    retry,
    isRetrying: read.retrying,
    unavailable: read.unavailable,
    errorCount: errorUpdateCount,
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
