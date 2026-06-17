import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export function useExecutionJournal(
  executionId: Id<'wfExecutions'> | undefined,
) {
  return useConvexQuery(
    api.workflow_executions.queries.getExecutionStepJournal,
    executionId ? { executionId } : 'skip',
  );
}

/**
 * Live status of a single execution (status / current step / error). Reactive,
 * so a tester that started a run sees it progress to completed/failed without
 * polling. Pass `undefined` to skip (no active run).
 */
export function useExecutionStatus(
  executionId: Id<'wfExecutions'> | undefined,
) {
  return useConvexQuery(
    api.workflow_executions.queries.getExecutionStatus,
    executionId ? { executionId } : 'skip',
  );
}

/**
 * Reactive per-node statuses for one execution, derived server-side from the
 * step journal (compact payload keyed by step slug). Drives the canvas node
 * badges and the test panel's per-step feedback. Accepts a plain string
 * because the id typically comes from the `execution` URL param; the backend
 * normalizes and returns `null` for malformed ids.
 */
export function useExecutionStepStatuses(executionId: string | undefined) {
  return useConvexQuery(
    api.workflow_executions.queries.getExecutionStepStatuses,
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
    api.workflow_executions.queries.listExecutions,
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
    api.workflow_executions.queries.listExecutionsCursor,
    args ? { ...args, cursor: undefined } : 'skip',
  );
}

export function useApproxExecutionCount(wfDefinitionId: string | undefined) {
  return useConvexQuery(
    api.workflow_executions.queries.approxCountExecutions,
    wfDefinitionId ? { wfDefinitionId } : 'skip',
  );
}
