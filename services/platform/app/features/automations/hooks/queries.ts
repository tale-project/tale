import type { Id } from '@/convex/_generated/dataModel';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useExecutionJournal(
  executionId: Id<'wfExecutions'> | undefined,
) {
  return useConvexQuery(
    api.wf_executions.queries.getExecutionStepJournal,
    executionId ? { executionId } : 'skip',
  );
}

interface ListExecutionsArgs {
  wfDefinitionId: string;
  status?: string[];
  triggeredBy?: string;
  dateFrom?: string;
  dateTo?: string;
  initialNumItems: number;
}

export function useListExecutions(args: ListExecutionsArgs | 'skip') {
  const queryArgs =
    args === 'skip'
      ? 'skip'
      : (() => {
          const { initialNumItems: _, ...rest } = args;
          return rest;
        })();
  const initialNumItems = args === 'skip' ? 10 : args.initialNumItems;

  return useCachedPaginatedQuery(
    api.wf_executions.queries.listExecutions,
    queryArgs,
    { initialNumItems },
  );
}

interface SearchExecutionArgs {
  wfDefinitionId: string;
  searchTerm: string;
  numItems: number;
}

export function useSearchExecution(args: SearchExecutionArgs | undefined) {
  return useConvexQuery(
    api.wf_executions.queries.listExecutionsCursor,
    args ? { ...args, cursor: undefined } : 'skip',
  );
}

export function useApproxExecutionCount(wfDefinitionId: string | undefined) {
  return useConvexQuery(
    api.wf_executions.queries.approxCountExecutions,
    wfDefinitionId ? { wfDefinitionId } : 'skip',
  );
}
