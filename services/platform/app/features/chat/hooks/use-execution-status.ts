import type { Id } from '@/convex/_generated/dataModel';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useExecutionStatus(
  executionId: Id<'wfExecutions'> | undefined,
) {
  return useConvexQuery(
    api.wf_executions.queries.getExecutionStatus,
    executionId ? { executionId } : 'skip',
  );
}

export function useCancelExecution() {
  return useConvexMutation(api.wf_executions.mutations.cancelExecution);
}
