/**
 * Helper function to get all workflows that have schedule triggers
 */

import { QueryCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';

export interface ScheduledWorkflow {
  wfDefinitionId: Id<'wfDefinitions'>;
  organizationId: string;
  name: string;
  schedule: string;
  timezone: string;
}

export async function getScheduledWorkflows(
  ctx: QueryCtx,
): Promise<ScheduledWorkflow[]> {
  // OPTIMIZATION: Batch load workflows and their trigger steps to avoid N+1 queries
  // Load active workflows with pagination limit to prevent timeout
  const MAX_WORKFLOWS = 100; // Limit to prevent timeout with many workflows

  const activeWorkflows = await ctx.db
    .query('wfDefinitions')
    .withIndex('by_status', (q) => q.eq('status', 'active'))
    .take(MAX_WORKFLOWS);

  if (activeWorkflows.length === 0) {
    return [];
  }

  // Batch load all trigger steps for active workflows
  // Group by organization for efficient querying
  const workflowIds = new Set(activeWorkflows.map((wf) => wf._id));
  const orgIds = [...new Set(activeWorkflows.map((wf) => wf.organizationId))];

  const allFirstSteps: any[] = [];

  // Batch query trigger steps per organization
  for (const orgId of orgIds) {
    const orgSteps = await ctx.db
      .query('wfStepDefs')
      .withIndex('by_organizationId_and_stepType_and_order', (q) =>
        q.eq('organizationId', orgId).eq('stepType', 'trigger').eq('order', 1)
      )
      .collect();
    allFirstSteps.push(...orgSteps);
  }

  // Create a map of wfDefinitionId -> first step
  const firstStepMap = new Map();
  for (const step of allFirstSteps) {
    if (workflowIds.has(step.wfDefinitionId) && step.order === 1) {
      firstStepMap.set(step.wfDefinitionId, step);
    }
  }

  // Build results without additional queries
  const results: ScheduledWorkflow[] = [];

  for (const wf of activeWorkflows) {
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

  return results;
}
