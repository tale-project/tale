import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Approval } from '@/lib/collections/entities/approvals';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { api } from '@/convex/_generated/api';

export function useApprovals(collection: Collection<Approval, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    approvals: data,
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
