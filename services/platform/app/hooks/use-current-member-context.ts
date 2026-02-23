import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * Routes under /dashboard/$id can call this without `skip` because the parent
 * route loader uses `ensureQueryData` to guarantee the member context is cached
 * before child routes render.
 *
 * The `skip` parameter is still available for callers outside the $id route tree
 * (e.g. routes that need to guard against auth token refreshes). When skipped,
 * `isLoading` is forced to `true` and the query uses `enabled: false` to preserve
 * the stable query key for cached data.
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
