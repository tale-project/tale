/**
 * Helpers to get the last execution start time (ms since epoch) for a workflow.
 *
 * IMPORTANT: file-based workflow slugs are NOT unique across organizations —
 * every org installs the same default-pack slugs (e.g. `tasks/daily-digest`).
 * All lookups are therefore org-scoped; a global slug lookup would let org A's
 * execution satisfy org B's schedule dedup and silently starve B's crons.
 */

import { QueryCtx } from '../../../_generated/server';

export interface OrgWorkflowKey {
  organizationId: string;
  workflowSlug: string;
}

/** Stable map key for batch results: `${organizationId}::${workflowSlug}`. */
export function orgWorkflowKey(key: OrgWorkflowKey): string {
  return `${key.organizationId}::${key.workflowSlug}`;
}

export async function getLastExecutionTimeForOrg(
  ctx: QueryCtx,
  args: OrgWorkflowKey,
): Promise<number | null> {
  const last = await ctx.db
    .query('wfExecutions')
    .withIndex('by_org_workflowSlug_startedAt', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('workflowSlug', args.workflowSlug),
    )
    .order('desc')
    .first();

  return last ? last.startedAt : null;
}

/**
 * Batch version to get last execution times for multiple (org, slug) pairs.
 * Result map is keyed by `orgWorkflowKey`. Duplicate pairs are queried once.
 */
export async function getLastExecutionTimesForOrgs(
  ctx: QueryCtx,
  args: { keys: OrgWorkflowKey[] },
): Promise<Map<string, number | null>> {
  const unique = new Map<string, OrgWorkflowKey>();
  for (const key of args.keys) {
    unique.set(orgWorkflowKey(key), key);
  }

  const entries = await Promise.all(
    [...unique.entries()].map(async ([mapKey, key]) => {
      const last = await getLastExecutionTimeForOrg(ctx, key);
      return [mapKey, last] as const;
    }),
  );

  return new Map(entries);
}
