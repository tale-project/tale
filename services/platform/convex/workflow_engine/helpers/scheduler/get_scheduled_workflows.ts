/**
 * Helper function to get all workflows that have schedule triggers.
 * Reads from the wfSchedules table (version-agnostic triggers).
 */

import type { Id } from '../../../_generated/dataModel';

import { QueryCtx } from '../../../_generated/server';
import { getActiveWorkflowVersion } from '../../../workflows/triggers/queries';

export interface ScheduledWorkflow {
  wfDefinitionId: Id<'wfDefinitions'>;
  organizationId: string;
  name: string;
  schedule: string;
  timezone: string;
  scheduleId: Id<'wfSchedules'>;
}

export async function getScheduledWorkflows(
  ctx: QueryCtx,
): Promise<ScheduledWorkflow[]> {
  const results: ScheduledWorkflow[] = [];

  const MAX_SCHEDULES = 200;
  const allSchedules = await ctx.db.query('wfSchedules').take(MAX_SCHEDULES);
  for (const sched of allSchedules) {
    if (!sched.isActive) continue;

    const activeVersion = await getActiveWorkflowVersion(
      ctx,
      sched.workflowRootId,
    );
    if (!activeVersion) continue;

    results.push({
      wfDefinitionId: activeVersion._id,
      organizationId: sched.organizationId,
      name: activeVersion.name,
      schedule: sched.cronExpression,
      timezone: sched.timezone,
      scheduleId: sched._id,
    });
  }

  return results;
}
