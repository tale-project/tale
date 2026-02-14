import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export type Approval = ConvexItemOf<
  typeof api.approvals.queries.listApprovalsByOrganization
>;

export function useApprovals(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.approvals.queries.listApprovalsByOrganization,
    { organizationId },
  );

  return {
    approvals: data ?? [],
    isLoading,
  };
}

interface ListApprovalsPaginatedArgs {
  organizationId: string;
  status?: 'pending' | 'approved' | 'rejected';
  resourceType?:
    | 'conversations'
    | 'product_recommendation'
    | 'integration_operation'
    | 'workflow_creation'
    | 'human_input_request';
  excludeStatus?: 'pending' | 'approved' | 'rejected';
  initialNumItems: number;
}

export function useListApprovalsPaginated(args: ListApprovalsPaginatedArgs) {
  const { initialNumItems, ...queryArgs } = args;
  return useCachedPaginatedQuery(
    api.approvals.queries.listApprovalsPaginated,
    queryArgs,
    { initialNumItems },
  );
}
