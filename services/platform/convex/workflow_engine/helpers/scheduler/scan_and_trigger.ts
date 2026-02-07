/**
 * Helper function to scan for workflows that need to be triggered based on their schedule.
 * Supports both wfSchedules table entries and legacy trigger step configs.
 */

import { ActionCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';
import { internal } from '../../../_generated/api';
import { shouldTriggerWorkflow } from './should_trigger_workflow';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

interface ScheduledWorkflow {
  wfDefinitionId: Id<'wfDefinitions'>;
  organizationId: string;
  name: string;
  schedule: string;
  timezone?: string;
  scheduleId?: Id<'wfSchedules'>;
}

export async function scanAndTrigger(ctx: ActionCtx): Promise<void> {
  try {
    debugLog('Starting scheduled workflow scan...');

    const scheduled = await ctx.runQuery(
      internal.workflow_engine.internal_queries.getScheduledWorkflows,
      {},
    ) as ScheduledWorkflow[];

    debugLog(`Found ${scheduled.length} scheduled workflows`);

    const wfDefinitionIds = scheduled.map((wf: ScheduledWorkflow) => wf.wfDefinitionId);
    const lastExecutionTimesObj = await ctx.runQuery(
      internal.workflow_engine.internal_queries.getLastExecutionTimes,
      { wfDefinitionIds },
    );

    let triggeredCount = 0;

    for (const {
      wfDefinitionId,
      organizationId,
      name,
      schedule,
      timezone,
      scheduleId,
    } of scheduled) {
      try {
        const lastExecutionMs = lastExecutionTimesObj[wfDefinitionId];

        const shouldTrigger = await shouldTriggerWorkflow(
          schedule,
          timezone || 'UTC',
          typeof lastExecutionMs === 'number' ? lastExecutionMs : null,
        );

        if (shouldTrigger) {
          debugLog(
            `Triggering scheduled workflow: ${name} (${wfDefinitionId})`,
          );

          await ctx.runMutation(internal.workflow_engine.internal_mutations.startWorkflow, {
            organizationId,
            wfDefinitionId,
            input: {},
            triggeredBy: 'schedule',
            triggerData: {
              triggerType: 'schedule',
              schedule,
              timestamp: Date.now(),
            },
          });

          if (scheduleId) {
            await ctx.runMutation(
              internal.workflows.triggers.internal_mutations.updateScheduleLastTriggered,
              { scheduleId, lastTriggeredAt: Date.now() },
            );
          }

          triggeredCount++;
        }
      } catch (error) {
        console.error(`Failed to trigger workflow ${wfDefinitionId}:`, error);
      }
    }

    debugLog(
      `Scheduled workflow scan completed. Triggered ${triggeredCount} workflows.`,
    );
  } catch (error) {
    console.error('Scheduled workflow scan failed:', error);
    throw error;
  }
}
