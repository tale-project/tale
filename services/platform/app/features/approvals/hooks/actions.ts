import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useExecuteApprovedIntegrationOperation() {
  return useConvexActionMutation(
    api.approvals.actions.executeApprovedIntegrationOperation,
  );
}

export function useExecuteApprovedWorkflowCreation() {
  return useConvexActionMutation(
    api.approvals.actions.executeApprovedWorkflowCreation,
  );
}
