/**
 * Check whether a workflow has an execution currently in 'running' or
 * 'pending' status. Used by the scheduler to prevent concurrent executions
 * of the same workflow.
 *
 * IMPORTANT: org-scoped on purpose — file-based workflow slugs repeat across
 * organizations (default pack), so a global slug check would let one org's
 * running execution suppress every other org's schedule.
 */

import type { QueryCtx } from '../../../_generated/server';
import type { OrgWorkflowKey } from './get_last_execution_time';
import { orgWorkflowKey } from './get_last_execution_time';

export async function hasRunningExecutionForOrg(
  ctx: QueryCtx,
  args: OrgWorkflowKey,
): Promise<boolean> {
  const [running, pending] = await Promise.all([
    ctx.db
      .query('wfExecutions')
      .withIndex('by_org_workflowSlug_status', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug)
          .eq('status', 'running'),
      )
      .first(),
    ctx.db
      .query('wfExecutions')
      .withIndex('by_org_workflowSlug_status', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug)
          .eq('status', 'pending'),
      )
      .first(),
  ]);

  return running !== null || pending !== null;
}

/**
 * Batch version for multiple (org, slug) pairs. Result map is keyed by
 * `orgWorkflowKey`. Duplicate pairs are queried once.
 */
export async function hasRunningExecutionsForOrgs(
  ctx: QueryCtx,
  args: { keys: OrgWorkflowKey[] },
): Promise<Map<string, boolean>> {
  const unique = new Map<string, OrgWorkflowKey>();
  for (const key of args.keys) {
    unique.set(orgWorkflowKey(key), key);
  }

  const entries = await Promise.all(
    [...unique.entries()].map(async ([mapKey, key]) => {
      const result = await hasRunningExecutionForOrg(ctx, key);
      return [mapKey, result] as const;
    }),
  );

  return new Map(entries);
}
