/**
 * List executions for workflow with cursor-based pagination
 *
 * Uses early termination to avoid reading all documents,
 * preventing the "Too many bytes read" error regardless of data volume.
 */

import type { QueryCtx } from '../../_generated/server';
import type {
  ListExecutionsCursorArgs,
  CursorPaginatedExecutionsResult,
  WorkflowExecution,
} from './types';
import { paginateWithFilter, DEFAULT_PAGE_SIZE } from '../../lib/pagination';

export async function listExecutionsCursor(
  ctx: QueryCtx,
  args: ListExecutionsCursorArgs,
): Promise<CursorPaginatedExecutionsResult> {
  const numItems = args.numItems ?? DEFAULT_PAGE_SIZE;

  // Parse date filters
  const fromDate = args.dateFrom
    ? new Date(args.dateFrom).getTime()
    : undefined;
  const toDate = args.dateTo ? new Date(args.dateTo).getTime() : undefined;

  // Pre-compute filter sets for O(1) lookups
  const searchLower = args.searchTerm?.toLowerCase();
  const statusSet = args.status?.length ? new Set(args.status) : null;
  const triggeredBySet = args.triggeredBy?.length
    ? new Set(args.triggeredBy.map((t) => t.toLowerCase()))
    : null;

  // Build query with optimal index for date filtering
  const baseQuery = ctx.db
    .query('wfExecutions')
    .withIndex('by_definition_startedAt', (q) => {
      if (fromDate !== undefined && toDate !== undefined) {
        return q
          .eq('wfDefinitionId', args.wfDefinitionId)
          .gte('startedAt', fromDate)
          .lte('startedAt', toDate);
      }

      if (fromDate !== undefined) {
        return q
          .eq('wfDefinitionId', args.wfDefinitionId)
          .gte('startedAt', fromDate);
      }

      if (toDate !== undefined) {
        return q
          .eq('wfDefinitionId', args.wfDefinitionId)
          .lte('startedAt', toDate);
      }

      return q.eq('wfDefinitionId', args.wfDefinitionId);
    })
    .order('desc');

  // Filter function for non-indexed fields
  const filter = (execution: WorkflowExecution): boolean => {
    // Status filter
    if (statusSet && !statusSet.has(execution.status)) {
      return false;
    }

    // Search filter (search in execution ID)
    if (
      searchLower &&
      !String(execution._id).toLowerCase().includes(searchLower)
    ) {
      return false;
    }

    // Triggered by filter
    if (triggeredBySet) {
      const execTriggeredBy = String(execution.triggeredBy ?? '').toLowerCase();
      if (!triggeredBySet.has(execTriggeredBy)) {
        return false;
      }
    }

    return true;
  };

  // Use paginateWithFilter for early termination
  // wfExecutions documents are large (variables, workflowConfig, input, output fields),
  // so use a conservative scan limit to stay under Convex's 16MB read limit
  return paginateWithFilter(baseQuery, {
    numItems,
    cursor: args.cursor,
    filter,
    maxScanItems: 100,
  });
}
