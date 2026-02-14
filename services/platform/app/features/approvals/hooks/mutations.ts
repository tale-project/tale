import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useRemoveRecommendedProduct() {
  return useConvexMutation(api.approvals.mutations.removeRecommendedProduct);
}

export function useUpdateApprovalStatus() {
  return useConvexOptimisticMutation(
    api.approvals.mutations.updateApprovalStatus,
    api.approvals.queries.listApprovalsByOrganization,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ approvalId, status }, { update }) =>
        update(approvalId, { status }),
    },
  );
}
