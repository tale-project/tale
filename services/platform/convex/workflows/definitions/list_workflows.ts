/**
 * List workflows for organization
 *
 * Optimized to use async iteration with early filtering.
 */

import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface ListWorkflowsArgs {
  organizationId: string;
  status?: string;
}

export async function listWorkflows(
  ctx: QueryCtx,
  args: ListWorkflowsArgs,
): Promise<WorkflowDefinition[]> {
  const query = args.status
    ? ctx.db
        .query('wfDefinitions')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', args.status!),
        )
    : ctx.db
        .query('wfDefinitions')
        .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId));

  const workflows: WorkflowDefinition[] = [];
  for await (const workflow of query) {
    workflows.push(workflow);
  }

  return workflows;
}
