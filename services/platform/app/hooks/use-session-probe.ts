import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { currentUserQuery } from '@/app/lib/backend/account';

const noSubscription = () => () => {};
const notRead = () => false;

/**
 * Whether the session probe (`currentUser`) holds a user, for a hook that
 * gates on it on one branch only: pass that branch's condition as `when`, and
 * read the answer on that branch alone (it is `false` when not asked).
 *
 * It is not an observer on the probe. react-query removes an observer in
 * time linear in its query's observer count, so one per mounted read made a
 * 2,000-card board take ~20 s to unmount (#4062), and even an unsubscribed
 * `useQuery` costs every read an observer object. With `when` false this
 * reads, fetches and listens to nothing. With `when` true it reads the cached
 * answer, asks for the probe when that answer is missing or stale (as a
 * mounting observer would), and re-renders on the probe's cache events
 * through a query-cache listener. Joining and leaving that listener set is
 * constant time, but every cache event calls every listener, so it suits
 * rare callers only: no shipped read lacks an adapter row.
 */
export function useSessionProbeSignedIn(when: boolean): boolean {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => {
      const probe = currentUserQuery();
      const probeHash = client.defaultQueryOptions(probe).queryHash;
      const stop = client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === probeHash) onChange();
      });
      void client.prefetchQuery(probe);
      return stop;
    },
    [client],
  );
  const read = useCallback(
    () => client.getQueryData(currentUserQuery().queryKey) != null,
    [client],
  );
  const snapshot = when ? read : notRead;
  return useSyncExternalStore(
    when ? subscribe : noSubscription,
    snapshot,
    snapshot,
  );
}
