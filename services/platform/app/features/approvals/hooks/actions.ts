import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useExecuteApprovedIntegrationOperation() {
  return useConvexAction(
    api.approvals.actions.executeApprovedIntegrationOperation,
  );
}

export function useExecuteApprovedWorkflowCreation() {
  return useConvexAction(api.approvals.actions.executeApprovedWorkflowCreation);
}

export function useExecuteApprovedWorkflowRun() {
  return useConvexAction(api.approvals.actions.executeApprovedWorkflowRun);
}
