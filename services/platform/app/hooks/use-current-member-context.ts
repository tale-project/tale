import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * Subscribes to the current user's membership context for an organization.
 *
 * Pass `skip = true` (e.g. while auth is loading) to disable the query
 * without changing the cache key. When skipped, `isLoading` is forced to
 * `true` and the query uses `enabled: false` to preserve cached data.
 */
export function useCurrentMemberContext(
  organizationId: string | undefined,
  skip = false,
) {
  const result = useConvexQuery(
    api.members.queries.getCurrentMemberContext,
    organizationId ? { organizationId } : 'skip',
    { enabled: !!organizationId && !skip },
  );

  return {
    ...result,
    isLoading: result.isLoading || skip,
  };
}
