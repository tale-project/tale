import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * IMPORTANT: Always pass `skip = isAuthLoading || !isAuthenticated` (from useConvexAuth)
 * to prevent the query from running during auth token refreshes. Without this, the backend
 * returns null (auth identity unavailable), causing false "Access denied" screens and
 * role-gated navigation items to disappear.
 *
 * When skipped, `isLoading` is forced to `true` because TanStack Query v5's
 * `isLoading` (= isPending && isFetching) is `false` for disabled queries,
 * which would let pages fall through their loading guards and show "Access denied".
 *
 * Using `enabled: false` (instead of changing args to 'skip') preserves the stable
 * `{ organizationId }` query key so TanStack Query returns cached data during auth
 * token refreshes — preventing a flash of missing permissions on component remount.
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
