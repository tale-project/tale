/**
 * List workflows for an organization, returning the best version per name.
 *
 * Priority: active > draft > archived, then highest versionNumber.
 *
 * Optimized to use async iteration with inline filtering and aggregation.
 * Supports optional search filtering by name and description.
 */

import type { WorkflowStatus } from '../../../lib/shared/schemas/wf_definitions';
import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

import { STATUS_PRIORITY } from '../../lib/helpers/status_priority';

export interface ListWorkflowsWithBestVersionArgs {
  organizationId: string;
  status?: WorkflowStatus;
  search?: string;
}

export async function listWorkflowsWithBestVersion(
  ctx: QueryCtx,
  args: ListWorkflowsWithBestVersionArgs,
): Promise<WorkflowDefinition[]> {
  const status = args.status;
  const query = status
    ? ctx.db
        .query('wfDefinitions')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', status),
        )
    : ctx.db
        .query('wfDefinitions')
        .withIndex('by_org', (q) =>
          q.eq('organizationId', args.organizationId),
        );

  const workflowMap = new Map<string, WorkflowDefinition>();
  const searchLower = args.search?.trim().toLowerCase();

  // Use async iteration with inline filtering and aggregation
  for await (const wf of query) {
    const workflow = wf;

    // Filter by search term if provided (matches name or description)
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

    const currentPriority = STATUS_PRIORITY[workflow.status] ?? 0;
    const existingPriority = STATUS_PRIORITY[existing.status] ?? 0;

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
