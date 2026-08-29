import { useQuery } from '@tanstack/react-query';

import { memberContextQuery } from '@/app/lib/backend/org';

/**
 * The current user's membership context for an organization (the 0.4
 * `getCurrentMemberContext` shape, served by the 0.5 backend).
 *
 * Pass `skip = true` (e.g. while auth is loading) to disable the query
 * without changing the cache key. When skipped, `isLoading` is forced to
 * `true` and the query uses `enabled: false` to preserve cached data.
 */
export function useCurrentMemberContext(
  organizationId: string | undefined,
  skip = false,
) {
  const result = useQuery({
    ...memberContextQuery(organizationId ?? ''),
    enabled: !!organizationId && !skip,
  });

  return {
    ...result,
    isLoading: result.isLoading || skip,
  };
}
