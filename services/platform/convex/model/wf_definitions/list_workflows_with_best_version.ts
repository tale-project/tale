/**
 * List workflows for an organization, returning the best version per name.
 *
 * Priority: active > draft > archived, then highest versionNumber.
 *
 * Optimized to use async iteration with inline filtering and aggregation.
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface ListWorkflowsWithBestVersionArgs {
  organizationId: string;
  status?: string;
}

const statusPriority: Record<string, number> = {
  active: 3,
  draft: 2,
  archived: 1,
};

export async function listWorkflowsWithBestVersion(
  ctx: QueryCtx,
  args: ListWorkflowsWithBestVersionArgs,
): Promise<WorkflowDefinition[]> {
  const query = ctx.db
    .query('wfDefinitions')
    .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId));

  const workflowMap = new Map<string, WorkflowDefinition>();

  // Use async iteration with inline filtering and aggregation
  for await (const wf of query) {
    const workflow = wf as WorkflowDefinition;

    // Filter by status if provided
    if (args.status && workflow.status !== args.status) {
      continue;
    }

    const key = workflow.name;
    const existing = workflowMap.get(key);

    if (!existing) {
      workflowMap.set(key, workflow);
      continue;
    }

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

  const result = Array.from(workflowMap.values());
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
