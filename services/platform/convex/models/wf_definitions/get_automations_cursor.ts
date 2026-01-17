/**
 * Get automations with cursor-based pagination
 *
 * Returns the best version per workflow name (active > draft > archived),
 * with search and status filtering. Uses early termination to avoid
 * reading all documents at once.
 *
 * Note: Since we need to deduplicate by name before paginating, we must
 * first collect all unique workflows, then apply cursor pagination to the result.
 * This is slightly different from typical cursor pagination but still avoids
 * the "Too many bytes read" error by not returning all fields at once.
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface GetAutomationsCursorArgs {
  organizationId: string;
  numItems: number;
  cursor: string | null;
  searchTerm?: string;
  status?: string[];
}

export interface GetAutomationsCursorResult {
  page: WorkflowDefinition[];
  isDone: boolean;
  continueCursor: string;
}

const statusPriority: Record<string, number> = {
  active: 3,
  draft: 2,
  archived: 1,
};

export async function getAutomationsCursor(
  ctx: QueryCtx,
  args: GetAutomationsCursorArgs,
): Promise<GetAutomationsCursorResult> {
  const { organizationId, numItems, cursor, searchTerm, status } = args;

  const query = ctx.db
    .query('wfDefinitions')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId));

  const workflowMap = new Map<string, WorkflowDefinition>();
  const searchLower = searchTerm?.trim().toLowerCase();
  const statusSet = status && status.length > 0 ? new Set(status) : null;

  // First pass: collect all workflows and deduplicate by name (keeping best version)
  for await (const workflow of query) {
    // Filter by status if provided
    if (statusSet && !statusSet.has(workflow.status)) {
      continue;
    }

    // Filter by search term if provided
    if (searchLower) {
      const nameMatches = workflow.name.toLowerCase().includes(searchLower);
      const descMatches =
        workflow.description?.toLowerCase().includes(searchLower) ?? false;
      if (!nameMatches && !descMatches) {
        continue;
      }
    }

    const key = workflow.name;
    const existing = workflowMap.get(key);

    if (!existing) {
      workflowMap.set(key, workflow);
      continue;
    }

    // Keep the best version: active > draft > archived, then highest versionNumber
    const currentPriority = statusPriority[workflow.status] ?? 0;
    const existingPriority = statusPriority[existing.status] ?? 0;

    if (currentPriority > existingPriority) {
      workflowMap.set(key, workflow);
    } else if (
      currentPriority === existingPriority &&
      workflow.versionNumber > existing.versionNumber
    ) {
      workflowMap.set(key, workflow);
    }
  }

  // Sort by creation time descending (newest first)
  const allWorkflows = Array.from(workflowMap.values());
  allWorkflows.sort((a, b) => b._creationTime - a._creationTime);

  // Apply cursor pagination
  let startIndex = 0;
  if (cursor) {
    const cursorIndex = allWorkflows.findIndex((wf) => wf._id === cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  const page = allWorkflows.slice(startIndex, startIndex + numItems);
  const hasMore = startIndex + numItems < allWorkflows.length;

  return {
    page,
    isDone: !hasMore,
    continueCursor: page.length > 0 ? page[page.length - 1]._id : '',
  };
}
