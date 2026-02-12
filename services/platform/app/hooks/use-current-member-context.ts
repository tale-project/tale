import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useCurrentMemberContext(
  organizationId: string | undefined,
  skip = false,
) {
  return useConvexQuery(
    api.members.queries.getCurrentMemberContext,
    !organizationId || skip ? 'skip' : { organizationId },
  );
}
