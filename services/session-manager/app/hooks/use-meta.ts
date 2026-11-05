import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { metaApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { pollInterval } from '@/app/lib/polling';

/**
 * The read of the app's state, under the one key the hook and the root route's
 * loader share: the loader has it in before the first frame (see
 * `routes/__root.tsx`).
 */
export function metaQuery() {
  return queryOptions({
    queryKey: queryKeys.meta,
    queryFn: ({ signal }) => metaApi.get({ signal }),
  });
}

/** The state of the app: the browser's installation, the counts, the secret kinds. */
export function useMeta() {
  const queryClient = useQueryClient();
  return useQuery({
    ...metaQuery(),
    refetchInterval: pollInterval(queryClient),
  });
}
