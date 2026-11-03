import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { proxiesApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { POLL_FAST_MS, pollInterval } from '@/app/lib/polling';
import type { Proxy } from '@/lib/api/schemas';

import { isChecking } from '../lib/health';

/**
 * The rows the first read asks for: the three pages of the table that
 * `useListPage` keeps loaded ahead of the reader.
 */
export const PROXIES_FIRST_WINDOW = DEFAULT_LIST_PAGE_SIZE * 3;

const NO_PROXIES: Proxy[] = [];

/** The words `useListPage` uses for where a paginated source stands. */
export type ProxyListStatus =
  | 'LoadingFirstPage'
  | 'CanLoadMore'
  | 'LoadingMore'
  | 'Exhausted';

/**
 * The newest proxies, a window that widens as the reader goes down the table
 * (`loadMore`) and refreshes as a whole, so the health of a row far down is
 * as current as the first one. It polls quickly while a check is running, on
 * what the table shows as well as on what the counts say.
 */
export function useProxyList() {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(PROXIES_FIRST_WINDOW);
  const query = useQuery({
    queryKey: queryKeys.proxyList(limit),
    queryFn: ({ signal }) => proxiesApi.list({ limit }, { signal }),
    refetchInterval: (current) => {
      const checking =
        current.state.status !== 'error' &&
        (current.state.data?.items.some(isChecking) ?? false);
      return checking ? POLL_FAST_MS : pollInterval(queryClient)(current);
    },
    // The rows stay while a wider window loads.
    placeholderData: keepPreviousData,
  });
  const proxies = query.data?.items ?? NO_PROXIES;
  const total = query.data?.total ?? 0;
  const loaded = proxies.length;
  const hasMore = loaded < total;

  // The window at least doubles: a search drains the pool window by window,
  // and a pool of thousands should take a handful of requests, not hundreds.
  // Asking for the same widening twice (the table does while it drains) costs
  // nothing, as the window only ever grows to the same size.
  const loadMore = useCallback(
    (count: number = DEFAULT_LIST_PAGE_SIZE) => {
      if (!hasMore) return;
      const wanted = Math.max(loaded + count, loaded * 2);
      setLimit((current) => Math.max(current, wanted));
    },
    [hasMore, loaded],
  );

  let status: ProxyListStatus = 'Exhausted';
  if (query.isPending) status = 'LoadingFirstPage';
  else if (query.isPlaceholderData) status = 'LoadingMore';
  else if (hasMore) status = 'CanLoadMore';

  return {
    proxies,
    total,
    hasMore,
    status,
    /** The first answer has not arrived. */
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    /** When the last failure came: a new one is a new thing to announce. */
    failedAt: query.errorUpdatedAt,
    /** A read, a poll or a retry, is on its way. */
    isFetching: query.isFetching,
    refetch: query.refetch,
    loadMore,
  };
}
