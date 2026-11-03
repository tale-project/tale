import { useQuery } from '@tanstack/react-query';

import { secretsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';

/**
 * One whole secret, hidden values included, fetched for the dialog that shows
 * or edits it, or for the item of a session's list that opens it: the lists
 * never carry them. It is read once and not kept: a form must not change under
 * the person's hands, and the values should not stay in memory once what shows
 * them is gone. Everything that reads a secret this way reads it through here,
 * since the options of a query belong to its key.
 */
export function useSecret(id: number) {
  return useQuery({
    queryKey: queryKeys.secret(id),
    queryFn: () => secretsApi.get(id),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}
