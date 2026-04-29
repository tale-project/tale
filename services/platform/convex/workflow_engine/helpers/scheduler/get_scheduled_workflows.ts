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
  for (const sched of allSchedules) {
    if (!sched.isActive) continue;
    if (!sched.workflowSlug) continue;

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
