/**
 * Helper function to get all workflows that have schedule triggers.
 * Reads from the wfSchedules table and resolves workflow slug for file-based workflows.
 */

import type { Id } from '../../../_generated/dataModel';
import { QueryCtx } from '../../../_generated/server';
import type { ConvexJsonRecord } from '../../../lib/validators/json';

export interface ScheduledWorkflow {
  workflowSlug: string;
  organizationId: string;
  name: string;
  schedule: string;
  timezone: string;
  scheduleId: Id<'wfSchedules'>;
  variables?: ConvexJsonRecord;
}

export async function getScheduledWorkflows(
  ctx: QueryCtx,
): Promise<ScheduledWorkflow[]> {
  const results: ScheduledWorkflow[] = [];

  const MAX_SCHEDULES = 200;
  const allSchedules = await ctx.db.query('wfSchedules').take(MAX_SCHEDULES);

  const installationCache = new Map<string, boolean>();
  const isInstalled = async (
    organizationId: string,
    workflowSlug: string,
  ): Promise<boolean> => {
    const cacheKey = `${organizationId}::${workflowSlug}`;
    const cached = installationCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const row = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', organizationId).eq('workflowSlug', workflowSlug),
      )
      .first();
    const exists = row !== null;
    installationCache.set(cacheKey, exists);
    return exists;
  };

  for (const sched of allSchedules) {
    if (!sched.isActive) continue;
    if (!sched.workflowSlug) continue;
    if (!(await isInstalled(sched.organizationId, sched.workflowSlug))) {
      continue;
    }

    results.push({
      workflowSlug: sched.workflowSlug,
      organizationId: sched.organizationId,
      name: sched.workflowSlug,
      schedule: sched.cronExpression,
      timezone: sched.timezone,
      scheduleId: sched._id,
      variables: sched.variables,
    });
  }

  return results;
}
