import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateApprovalStatus() {
  return useMutation(api.approvals.mutations.updateApprovalStatus);
}
