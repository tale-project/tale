import { useQuery, useQueryClient } from '@tanstack/react-query';

import { secretsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { pollInterval } from '@/app/lib/polling';

/**
 * Every list of secrets. What a write makes stale is the lists, not the one
 * secret a dialog may be showing: its form keeps what it opened with.
 */
export const SECRET_LISTS = [...queryKeys.secrets, 'list'] as const;

/**
 * All the secrets, newest first, kept current: an assistant can add, change
 * or delete one while the page is open. There are few of them, so the list
 * comes whole and the page narrows it. A summary never has a hidden value.
 */
export function useSecrets() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.secretList({}),
    queryFn: ({ signal }) => secretsApi.list({}, { signal }),
    refetchInterval: pollInterval(queryClient),
  });
}
