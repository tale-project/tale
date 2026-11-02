import { useQuery, useQueryClient } from '@tanstack/react-query';

import { metaApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { pollInterval } from '@/app/lib/polling';

/** The state of the app: the browser's installation, the counts, the secret kinds. */
export function useMeta() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: ({ signal }) => metaApi.get({ signal }),
    refetchInterval: pollInterval(queryClient),
  });
}
