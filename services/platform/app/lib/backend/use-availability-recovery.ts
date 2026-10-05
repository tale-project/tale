import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useBackendReachable } from './connection-state';

/** Refresh reads after an outage, including errors that exhausted retries.
 * Mutations are never retried: the user decides whether to submit again. */
export function useAvailabilityRecovery(): void {
  const reachable = useBackendReachable();
  const queryClient = useQueryClient();
  const wasUnavailable = useRef(!reachable);
  useEffect(() => {
    if (!reachable) {
      wasUnavailable.current = true;
    } else if (wasUnavailable.current) {
      wasUnavailable.current = false;
      void queryClient.invalidateQueries({ queryKey: ['backend'] });
    }
  }, [reachable, queryClient]);
}
