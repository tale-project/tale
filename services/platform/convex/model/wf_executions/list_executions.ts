/**
 * List executions for workflow
 */

import type { QueryCtx } from '../../_generated/server';
import type { ListExecutionsArgs, WorkflowExecution } from './types';

export async function listExecutions(
  ctx: QueryCtx,
  args: ListExecutionsArgs,
): Promise<WorkflowExecution[]> {
  // Stream results using the index so we don't load the entire history into
  // memory, but still honor the caller-provided limit (with a reasonable cap
  // to avoid Convex byte limits).
  const requestedLimit = args.limit && args.limit > 0 ? args.limit : 50;
  const limit = Math.min(requestedLimit, 200);
  const maxScan = Math.min(limit * 3, 600);

  const fromDate = args.dateFrom
    ? new Date(args.dateFrom).getTime()
    : undefined;
  const toDate = args.dateTo ? new Date(args.dateTo).getTime() : undefined;
  const searchLower = args.search?.toLowerCase();
  const triggeredByLower = args.triggeredBy?.toLowerCase();

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

  const results: WorkflowExecution[] = [];
  let scanned = 0;

  // Walk the newest executions first. Stop when we've scanned enough rows or
  // collected the requested number of matches.
  for await (const execution of baseQuery) {
    scanned += 1;
    if (scanned > maxScan) {
      break;
    }

    if (args.status && execution.status !== args.status) {
      continue;
    }

    if (
      searchLower &&
      !String(execution._id).toLowerCase().includes(searchLower)
    ) {
      continue;
    }

    if (
      triggeredByLower &&
      !String(execution.triggeredBy ?? '')
        .toLowerCase()
        .includes(triggeredByLower)
    ) {
      continue;
    }

    results.push(execution as WorkflowExecution);

    if (results.length >= limit) {
      break;
    }
  }

  return results;
}
