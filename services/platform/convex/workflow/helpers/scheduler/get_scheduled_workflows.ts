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
  // Stream active workflows to avoid loading everything into memory at once
  const activeWorkflows = ctx.db
    .query('wfDefinitions')
    .withIndex('by_status', (q) => q.eq('status', 'active'));

  const results: ScheduledWorkflow[] = [];

  for await (const wf of activeWorkflows) {
    const firstStep = await ctx.db
      .query('wfStepDefs')
      .withIndex('by_definition_order', (q) =>
        q.eq('wfDefinitionId', wf._id).eq('order', 1),
      )
      .first();

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
