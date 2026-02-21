import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

/**
 * IMPORTANT: Always pass `skip = isAuthLoading || !isAuthenticated` (from useConvexAuth)
 * to prevent the query from running during auth token refreshes. Without this, the backend
 * returns null (auth identity unavailable), causing false "Access denied" screens and
 * role-gated navigation items to disappear.
 */
export function useCurrentMemberContext(
  organizationId: string | undefined,
  skip = false,
) {
  return useConvexQuery(
    api.members.queries.getCurrentMemberContext,
    !organizationId || skip ? 'skip' : { organizationId },
  );
}
