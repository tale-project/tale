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
  const query = ctx.db
    .query('wfDefinitions')
    .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId));

  // Use async iteration with inline filtering
  const workflows: WorkflowDefinition[] = [];

  for await (const workflow of query) {
    // Filter by status if provided
    if (args.status && workflow.status !== args.status) {
      continue;
    }
    workflows.push(workflow);
  }

  return workflows;
}
