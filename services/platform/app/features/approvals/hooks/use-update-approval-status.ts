import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Uses preloaded query with complex filters - params not predictable
export function useUpdateApprovalStatus() {
  return useMutation(api.mutations.approvals.updateApprovalStatusPublic);
}
