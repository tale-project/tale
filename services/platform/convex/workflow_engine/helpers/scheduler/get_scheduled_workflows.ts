/**
 * Helper function to get all workflows that have schedule triggers.
 * Reads from both:
 *   1. wfSchedules table (new version-agnostic triggers)
 *   2. Legacy trigger step configs (backward compatibility)
 */

import { QueryCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';
import { getActiveWorkflowVersion } from '../../../workflows/triggers/queries';

export interface ScheduledWorkflow {
  wfDefinitionId: Id<'wfDefinitions'>;
  organizationId: string;
  name: string;
  schedule: string;
  timezone: string;
  scheduleId?: Id<'wfSchedules'>;
}

export async function getScheduledWorkflows(
  ctx: QueryCtx,
): Promise<ScheduledWorkflow[]> {
  const results: ScheduledWorkflow[] = [];
  const seenWorkflowIds = new Set<string>();

  // --- Source 1: wfSchedules table (version-agnostic) ---
  const MAX_SCHEDULES = 200;
  const allSchedules = await ctx.db.query('wfSchedules').take(MAX_SCHEDULES);
  for (const sched of allSchedules) {
    if (!sched.isActive) continue;

    const activeVersion = await getActiveWorkflowVersion(ctx, sched.workflowRootId);
    if (!activeVersion) continue;

    seenWorkflowIds.add(activeVersion._id);
    results.push({
      wfDefinitionId: activeVersion._id,
      organizationId: sched.organizationId,
      name: activeVersion.name,
      schedule: sched.cronExpression,
      timezone: sched.timezone,
      scheduleId: sched._id,
    });
  }

  // --- Source 2: Legacy trigger step configs (backward compatibility) ---
  const MAX_WORKFLOWS = 100;
  const activeWorkflows = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_status', (q) => q.eq('status', 'active'))
    .take(MAX_WORKFLOWS);

  if (activeWorkflows.length > 0) {
    const workflowIds = new Set(activeWorkflows.map((wf) => wf._id));
    const orgIds = [...new Set(activeWorkflows.map((wf) => wf.organizationId))];

    const orgStepsResults = await Promise.all(
      orgIds.map((orgId) =>
        ctx.db
          .query('wfStepDefs')
          .withIndex('by_organizationId_and_stepType_and_order', (q) =>
            q.eq('organizationId', orgId).eq('stepType', 'trigger').eq('order', 1),
          )
          .collect(),
      ),
    );
    const allFirstSteps = orgStepsResults.flat();

    const firstStepMap = new Map();
    for (const step of allFirstSteps) {
      if (workflowIds.has(step.wfDefinitionId) && step.order === 1) {
        firstStepMap.set(step.wfDefinitionId, step);
      }
    }

    for (const wf of activeWorkflows) {
      if (seenWorkflowIds.has(wf._id)) continue;

      const firstStep = firstStepMap.get(wf._id);
      if (!firstStep || firstStep.stepType !== 'trigger') continue;

      const cfg = firstStep.config as {
        type?: string;
        schedule?: string;
        timezone?: string;
      };
      const schedule: string | undefined =
        cfg.type === 'scheduled' ? cfg.schedule : undefined;
      if (!schedule || schedule.trim() === '') continue;

      const timezone =
        cfg.timezone && cfg.timezone.trim() !== '' ? cfg.timezone : 'UTC';

      results.push({
        wfDefinitionId: wf._id,
        organizationId: wf.organizationId,
        name: wf.name,
        schedule,
        timezone,
      });
    }
  }

  return results;
}
