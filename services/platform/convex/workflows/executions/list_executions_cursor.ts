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
  const emptyResult: CursorPaginatedExecutionsResult = {
    page: [],
    isDone: true,
    continueCursor: '',
  };

  // Exact ID lookup — returns the single matching execution or empty result.
  // All other filters (status, date, triggeredBy) are ignored when searching.
  if (args.searchTerm) {
    const normalizedId = ctx.db.normalizeId(
      'wfExecutions',
      args.searchTerm.trim(),
    );
    if (!normalizedId) return emptyResult;

    const execution = await ctx.db.get(normalizedId);
    if (!execution || execution.wfDefinitionId !== args.wfDefinitionId) {
      return emptyResult;
    }
    return { page: [execution], isDone: true, continueCursor: '' };
  }

  const numItems = args.numItems ?? DEFAULT_PAGE_SIZE;

  // Parse date filters
  const fromDate = args.dateFrom
    ? new Date(args.dateFrom).getTime()
    : undefined;
  const toDate = args.dateTo ? new Date(args.dateTo).getTime() : undefined;

  const statusSet = args.status?.length ? new Set(args.status) : null;

  // When triggeredBy is provided, use the compound index for fully indexed
  // filtering (wfDefinitionId + triggeredBy + startedAt).
  // Otherwise fall back to the date-only index.
  const baseQuery = args.triggeredBy
    ? ctx.db
        .query('wfExecutions')
        .withIndex('by_definition_triggeredBy_startedAt', (q) => {
          const base = q
            .eq('wfDefinitionId', args.wfDefinitionId)
            .eq('triggeredBy', args.triggeredBy);

          if (fromDate !== undefined && toDate !== undefined) {
            return base.gte('startedAt', fromDate).lte('startedAt', toDate);
          }
          if (fromDate !== undefined) return base.gte('startedAt', fromDate);
          if (toDate !== undefined) return base.lte('startedAt', toDate);
          return base;
        })
        .order('desc')
    : ctx.db
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

  const filter = statusSet
    ? (execution: WorkflowExecution) => statusSet.has(execution.status)
    : undefined;

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
