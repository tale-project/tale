import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import { currentUserQuery } from '@/app/lib/backend/account';

const noSubscription = () => () => {};
const notRead = () => false;

/**
 * Whether the session probe (`currentUser`) holds a user, for a hook that
 * gates on it on one branch only: pass that branch's condition as `when`.
 *
 * It is not an observer on the probe. react-query removes an observer in
 * time linear in its query's observer count, so one per mounted read made a
 * 2,000-card board take ~20 s to unmount (#4062), and even an unsubscribed
 * `useQuery` costs every read an observer object. With `when` false this
 * reads and subscribes to nothing. With `when` true it reads the cached
 * answer and re-renders on the probe's cache events, through a cache
 * listener that joins and leaves in constant time. It never fetches the
 * probe: `useSessionUser` at the app root (`main.tsx`) keeps it observed.
 */
export function useSessionProbeSignedIn(when: boolean): boolean {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => {
      const probeHash =
        client.defaultQueryOptions(currentUserQuery()).queryHash;
      return client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === probeHash) onChange();
      });
    },
    [client],
  );
  const read = useCallback(
    () => client.getQueryData(currentUserQuery().queryKey) != null,
    [client],
  );
  return useSyncExternalStore(
    when ? subscribe : noSubscription,
    when ? read : notRead,
  );
}
