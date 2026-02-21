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
 */
export function useCurrentMemberContext(
  organizationId: string | undefined,
  skip = false,
) {
  const result = useConvexQuery(
    api.members.queries.getCurrentMemberContext,
    !organizationId || skip ? 'skip' : { organizationId },
  );

  return {
    ...result,
    isLoading: result.isLoading || skip,
  };
}
