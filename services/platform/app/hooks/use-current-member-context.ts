import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * The parent route loader (`/dashboard/$id`) prefetches this query so data is
 * typically available on first render during client-side navigation. On a cold
 * page refresh the data may still be loading; callers should handle `isLoading`
 * or guard against `undefined` data.
 *
 * The `skip` parameter is available for callers outside the $id route tree
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
