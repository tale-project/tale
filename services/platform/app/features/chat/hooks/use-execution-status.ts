import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export function useExecutionStatus(
  executionId: Id<'wfExecutions'> | undefined,
) {
  return useConvexQuery(
    api.workflow_executions.queries.getExecutionStatus,
    executionId ? { executionId } : 'skip',
  );
}

export function useWorkflowHumanInputApproval(approvalId: string | undefined) {
  const organizationId = useOrganizationId();
  return useConvexQuery(
    api.approvals.queries.getApproval,
    approvalId && organizationId
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- approval ID string from execution.waitingFor
        { approvalId: approvalId as Id<'approvals'>, organizationId }
      : 'skip',
  );
}

export function useCancelExecution() {
  return useConvexMutation(api.workflow_executions.mutations.cancelExecution);
}
