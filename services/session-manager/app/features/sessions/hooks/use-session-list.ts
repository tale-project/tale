import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { sessionsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { pollInterval } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';

export const SESSIONS_PAGE_SIZE = 50;

const NO_SESSIONS: Session[] = [];

/**
 * The newest sessions, `SESSIONS_PAGE_SIZE` at a time: `loadMore` widens the
 * window, which then refreshes as a whole (so a status that changed in a row
 * the person scrolled to is as current as the first one). `readBackTo` widens
 * it straight to a session that is older than every row loaded (its page was
 * opened from a link) instead of one page after another.
 */
export function useSessionList() {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(SESSIONS_PAGE_SIZE);
  // The oldest id the window holds, once it was read back to a session: then
  // it is every session from that one up (see `readBackTo`).
  const [minId, setMinId] = useState<number | undefined>(undefined);
  const query = useQuery({
    queryKey: queryKeys.sessionList(limit, minId),
    queryFn: ({ signal }) =>
      sessionsApi.list(minId === undefined ? { limit } : { limit, minId }, {
        signal,
      }),
    refetchInterval: pollInterval(queryClient),
    // The rows stay while a wider window loads.
    placeholderData: keepPreviousData,
  });
  const sessions = query.data?.items ?? NO_SESSIONS;
  const total = query.data?.total ?? 0;

  // The next page goes on from the rows there are, however they were read.
  const loaded = sessions.length;
  const loadMore = useCallback(() => {
    setMinId(undefined);
    setLimit(loaded + SESSIONS_PAGE_SIZE);
  }, [loaded]);

  // Every session from `id` up, which can be all of them: a window is the
  // newest `limit` rows, so it is as wide as the list is long, and `minId`
  // keeps it from reading further back than the session it is for.
  const readBackTo = useCallback(
    (id: number) => {
      setMinId(id);
      setLimit(Math.max(total, SESSIONS_PAGE_SIZE));
    },
    [total],
  );

  return {
    sessions,
    total,
    hasMore: sessions.length < total,
    /** A wider window is loading. */
    isLoadingMore: query.isPlaceholderData,
    /** The first answer has not arrived. */
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    /** A read is under way: the first, a wider window, a poll or a retry. */
    isFetching: query.isFetching,
    /** When the last read failed (a new failure is announced again); 0 before any. */
    errorUpdatedAt: query.errorUpdatedAt,
    refetch: query.refetch,
    loadMore,
    readBackTo,
  };
}
