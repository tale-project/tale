import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useBackendReachable } from './connection-state';

const pendingRecoveries = new WeakMap<QueryClient, number>();

function countPendingRecovery(client: QueryClient, delta: 1 | -1): void {
  const pending = (pendingRecoveries.get(client) ?? 0) + delta;
  if (pending > 0) pendingRecoveries.set(client, pending);
  else pendingRecoveries.delete(client);
}

/** An observed outage will refresh this client's reads on the next positive
 * verdict. SSE replay recovery can leave that refresh to the same owner. */
export function hasPendingAvailabilityRecovery(client: QueryClient): boolean {
  return pendingRecoveries.has(client);
}

/** Refresh reads after an outage, including errors that exhausted retries.
 * Mutations are never retried: the user decides whether to submit again. */
export function useAvailabilityRecovery(): void {
  const reachable = useBackendReachable();
  const queryClient = useQueryClient();
  // Pending from the outage until the refresh is issued. An effect cleanup
  // would end it before the recovering run, while the refresh is still owed.
  const pending = useRef(false);
  useEffect(() => {
    if (!reachable) {
      if (!pending.current) {
        pending.current = true;
        countPendingRecovery(queryClient, 1);
      }
    } else if (pending.current) {
      pending.current = false;
      countPendingRecovery(queryClient, -1);
      void queryClient.invalidateQueries({ queryKey: ['backend'] });
    }
  }, [reachable, queryClient]);
  // An unmounted owner refreshes nothing, so it owes nothing either.
  useEffect(
    () => () => {
      if (pending.current) {
        pending.current = false;
        countPendingRecovery(queryClient, -1);
      }
    },
    [queryClient],
  );
}
