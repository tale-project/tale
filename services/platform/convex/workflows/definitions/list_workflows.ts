/**
 * List workflows for organization
 *
 * Optimized to use async iteration with early filtering.
 */

import type { WorkflowStatus } from '../../../lib/shared/schemas/wf_definitions';
import type { QueryCtx } from '../../_generated/server';
import type { WorkflowDefinition } from './types';

export interface ListWorkflowsArgs {
  organizationId: string;
  status?: WorkflowStatus;
}

export async function listWorkflows(
  ctx: QueryCtx,
  args: ListWorkflowsArgs,
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

  const workflows: WorkflowDefinition[] = [];
  for await (const workflow of query) {
    workflows.push(workflow);
  }

  return workflows;
}
