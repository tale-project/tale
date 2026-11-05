import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { sessionsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { pollInterval } from '@/app/lib/polling';

import { readSession } from '../lib/removal';

interface UseSessionOptions {
  /** Read it only when it is wanted (the list asks for the open session only while its rows lack it). */
  enabled?: boolean;
}

/**
 * The read of one session, under the one key the hook and the session page's
 * loader share (see `routes/sessions/$sessionId.tsx`).
 */
export function sessionQuery(queryClient: QueryClient, id: number) {
  return queryOptions({
    queryKey: queryKeys.session(id),
    queryFn: ({ signal }) =>
      readSession(queryClient, id, () => sessionsApi.get(id, { signal })),
  });
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
    ...sessionQuery(queryClient, id),
    refetchInterval: pollInterval(queryClient),
    enabled,
  });
}
