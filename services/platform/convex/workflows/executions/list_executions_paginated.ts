/**
 * List executions for workflow with offset-based pagination
 */

import type { QueryCtx } from '../../_generated/server';
import type {
  ListExecutionsPaginatedArgs,
  PaginatedExecutionsResult,
  WorkflowExecution,
} from './types';

import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../lib/pagination';

// Maximum number of documents to scan to prevent "Too many bytes read" error
// Convex limit is 16MB per query, typical execution doc ~1-5KB, so 2000 is safe
const MAX_SCAN_LIMIT = 2000;

export async function listExecutionsPaginated(
  ctx: QueryCtx,
  args: ListExecutionsPaginatedArgs,
): Promise<PaginatedExecutionsResult> {
  // Normalize pagination
  const page = Math.max(args.currentPage ?? DEFAULT_PAGE, 1);
  const pageSize = Math.min(
    Math.max(args.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const skip = (page - 1) * pageSize;

  // Parse date filters
  const fromDate = args.dateFrom
    ? new Date(args.dateFrom).getTime()
    : undefined;
  const toDate = args.dateTo ? new Date(args.dateTo).getTime() : undefined;
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

  // Collect matching items with scan limit to prevent "Too many bytes read" error
  const allMatching: WorkflowExecution[] = [];
  let scannedCount = 0;
  let reachedScanLimit = false;

  for await (const execution of baseQuery) {
    scannedCount++;

    // Stop scanning if we hit the limit to prevent memory/byte errors
    if (scannedCount > MAX_SCAN_LIMIT) {
      reachedScanLimit = true;
      break;
    }

    // Apply in-memory filters
    if (statusSet && !statusSet.has(execution.status)) {
      continue;
    }

    if (
      searchLower &&
      !String(execution._id).toLowerCase().includes(searchLower)
    ) {
      continue;
    }

    if (triggeredBySet) {
      const execTriggeredBy = String(execution.triggeredBy ?? '').toLowerCase();
      if (!triggeredBySet.has(execTriggeredBy)) {
        continue;
      }
    }

    allMatching.push(execution as WorkflowExecution);
  }

  // If we hit the scan limit, total is approximate (at least this many)
  const total = reachedScanLimit ? allMatching.length : allMatching.length;

  // Apply sorting
  const sortField = args.sortField || 'startedAt';
  const sortOrder = args.sortOrder || 'desc';
  allMatching.sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[sortField];
    const bVal = (b as Record<string, unknown>)[sortField];
    if (aVal === bVal) return 0;
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    const comparison = aVal < bVal ? -1 : 1;
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const items = allMatching.slice(skip, skip + pageSize);
  const totalPages = Math.ceil(total / pageSize);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    hasMore: reachedScanLimit,
  };
}
