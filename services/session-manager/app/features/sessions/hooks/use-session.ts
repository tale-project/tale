import { useQuery, useQueryClient } from '@tanstack/react-query';

import { sessionsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { pollInterval } from '@/app/lib/polling';

import { readSession } from '../lib/removal';

interface UseSessionOptions {
  /** Read it only when it is wanted (the list asks for the open session only while its rows lack it). */
  enabled?: boolean;
}

/**
 * One session, kept current. A session that does not exist is a 404 `ApiError`,
 * which is also what one that is being deleted, or was, answers: nothing is
 * asked of it any more (see `readSession`).
 */
export function useSession(
  id: number,
  { enabled = true }: UseSessionOptions = {},
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.session(id),
    queryFn: ({ signal }) =>
      readSession(queryClient, id, () => sessionsApi.get(id, { signal })),
    refetchInterval: pollInterval(queryClient),
    enabled,
  });
}
