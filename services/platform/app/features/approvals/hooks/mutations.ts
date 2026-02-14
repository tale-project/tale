import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useRemoveRecommendedProduct() {
  return useConvexMutation(api.approvals.mutations.removeRecommendedProduct);
}

export function useUpdateApprovalStatus() {
  return useConvexMutation(api.approvals.mutations.updateApprovalStatus);
}
