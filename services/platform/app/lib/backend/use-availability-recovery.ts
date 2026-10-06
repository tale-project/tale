import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useBackendReachable } from './connection-state';

const pendingRecoveries = new WeakMap<QueryClient, number>();

/** An observed outage will refresh this client's reads on the next positive
 * verdict. SSE replay recovery can leave that refresh to the same owner. */
export function hasPendingAvailabilityRecovery(client: QueryClient): boolean {
  return (pendingRecoveries.get(client) ?? 0) > 0;
}

/** Refresh reads after an outage, including errors that exhausted retries.
 * Mutations are never retried: the user decides whether to submit again. */
export function useAvailabilityRecovery(): void {
  const reachable = useBackendReachable();
  const queryClient = useQueryClient();
  const wasUnavailable = useRef(!reachable);
  useEffect(() => {
    if (!reachable) {
      wasUnavailable.current = true;
      pendingRecoveries.set(
        queryClient,
        (pendingRecoveries.get(queryClient) ?? 0) + 1,
      );
      return () => {
        const remaining = (pendingRecoveries.get(queryClient) ?? 1) - 1;
        if (remaining > 0) pendingRecoveries.set(queryClient, remaining);
        else pendingRecoveries.delete(queryClient);
      };
    } else if (wasUnavailable.current) {
      wasUnavailable.current = false;
      void queryClient.invalidateQueries({ queryKey: ['backend'] });
    }
    return undefined;
  }, [reachable, queryClient]);
}
