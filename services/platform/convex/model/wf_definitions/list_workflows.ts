/**
 * List workflows for organization
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

  const workflows = await query.collect();

  // Filter by status if provided
  return workflows.filter((workflow) => {
    if (args.status && workflow.status !== args.status) return false;
    return true;
  });
}
