/**
 * List executions using Convex native .paginate() for use with usePaginatedQuery.
 *
 * Unlike the cursor-based helper, this leverages Convex's built-in pagination
 * so the frontend can use usePaginatedQuery / useCachedPaginatedQuery with
 * automatic multi-page subscription management.
 */

import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowExecution } from './types';

interface ListExecutionsPaginatedArgs {
  paginationOpts: PaginationOptions;
  wfDefinitionId: string;
  status?: string[];
  triggeredBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function listExecutionsPaginatedNative(
  ctx: QueryCtx,
  args: ListExecutionsPaginatedArgs,
): Promise<PaginationResult<WorkflowExecution>> {
  const fromDate = args.dateFrom
    ? new Date(args.dateFrom).getTime()
    : undefined;
  const toDate = args.dateTo ? new Date(args.dateTo).getTime() : undefined;

  const statusSet =
    args.status && args.status.length > 0 ? new Set(args.status) : null;

  // Pick the best index based on provided filters.
  // When triggeredBy is provided, use the compound index for fully indexed
  // filtering (wfDefinitionId + triggeredBy + startedAt).
  let baseQuery = args.triggeredBy
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

  // Apply status filter server-side before pagination
  if (statusSet) {
    const statuses = [...statusSet];
    baseQuery = baseQuery.filter((q) => {
      if (statuses.length === 1) {
        return q.eq(q.field('status'), statuses[0]);
      }
      return q.or(...statuses.map((s) => q.eq(q.field('status'), s)));
    });
  }

  return await baseQuery.paginate(args.paginationOpts);
}
