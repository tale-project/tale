import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useExecuteApprovedIntegrationOperation() {
  return useConvexAction(
    api.approvals.actions.executeApprovedIntegrationOperation,
    {
      invalidates: [api.approvals.queries.listApprovalsByOrganization],
    },
  );
}

export function useExecuteApprovedWorkflowCreation() {
  return useConvexAction(
    api.approvals.actions.executeApprovedWorkflowCreation,
    {
      invalidates: [
        api.approvals.queries.listApprovalsByOrganization,
        api.wf_definitions.queries.listAutomations,
      ],
    },
  );
}
