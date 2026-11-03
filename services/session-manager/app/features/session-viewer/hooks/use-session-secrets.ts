import { useQuery } from '@tanstack/react-query';

import { secretsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';

/**
 * The secrets a session can use: its own and the ones for every session
 * (summaries; no value of them is masked). Read afresh each time the list is
 * opened, and not kept after it is closed.
 */
export function useSessionSecrets(sessionId: number) {
  const filter = { scope: String(sessionId), includeGlobal: true };
  return useQuery({
    queryKey: queryKeys.secretList(filter),
    queryFn: ({ signal }) => secretsApi.list(filter, { signal }),
    staleTime: 0,
    gcTime: 0,
  });
}
