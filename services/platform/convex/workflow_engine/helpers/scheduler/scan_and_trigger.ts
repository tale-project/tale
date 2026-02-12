/**
 * Helper function to scan for workflows that need to be triggered based on their schedule.
 * Reads from the wfSchedules table via getScheduledWorkflows.
 */

import type { Id } from '../../../_generated/dataModel';

import { internal } from '../../../_generated/api';
import { ActionCtx } from '../../../_generated/server';
import { createDebugLog } from '../../../lib/debug_log';
import { shouldTriggerWorkflow } from './should_trigger_workflow';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

interface ScheduledWorkflow {
  wfDefinitionId: Id<'wfDefinitions'>;
  organizationId: string;
  name: string;
  schedule: string;
  timezone: string;
  scheduleId: Id<'wfSchedules'>;
}

export async function scanAndTrigger(ctx: ActionCtx): Promise<void> {
  try {
    debugLog('Starting scheduled workflow scan...');

    const scheduled = (await ctx.runQuery(
      internal.workflow_engine.internal_queries.getScheduledWorkflows,
      {},
    )) as ScheduledWorkflow[];

    debugLog(`Found ${scheduled.length} scheduled workflows`);

    const wfDefinitionIds = scheduled.map(
      (wf: ScheduledWorkflow) => wf.wfDefinitionId,
    );
    const lastExecutionTimesObj = await ctx.runQuery(
      internal.workflow_engine.internal_queries.getLastExecutionTimes,
      { wfDefinitionIds },
    );

    const runningExecutionsObj = (await ctx.runQuery(
      internal.workflow_engine.internal_queries.getRunningExecutions,
      { wfDefinitionIds },
    )) as Record<string, boolean>;

    let triggeredCount = 0;
    let skippedRunning = 0;

    for (const {
      wfDefinitionId,
      organizationId,
      name,
      schedule,
      timezone,
      scheduleId,
    } of scheduled) {
      try {
        if (runningExecutionsObj[wfDefinitionId]) {
          debugLog(
            `Skipping workflow (already running): ${name} (${wfDefinitionId})`,
          );
          skippedRunning++;
          continue;
        }

        const lastExecutionMs = lastExecutionTimesObj[wfDefinitionId];

        const shouldTrigger = await shouldTriggerWorkflow(
          schedule,
          timezone,
          typeof lastExecutionMs === 'number' ? lastExecutionMs : null,
        );

        if (shouldTrigger) {
          debugLog(
            `Triggering scheduled workflow: ${name} (${wfDefinitionId})`,
          );

          await ctx.runMutation(
            internal.workflow_engine.internal_mutations.startWorkflow,
            {
              organizationId,
              wfDefinitionId,
              input: {},
              triggeredBy: 'schedule',
              triggerData: {
                triggerType: 'schedule',
                schedule,
                timestamp: Date.now(),
              },
            },
          );

          await ctx.runMutation(
            internal.workflows.triggers.internal_mutations
              .updateScheduleLastTriggered,
            { scheduleId, lastTriggeredAt: Date.now() },
          );

          triggeredCount++;
        }
      } catch (error) {
        console.error(`Failed to trigger workflow ${wfDefinitionId}:`, error);
      }
    }

    debugLog(
      `Scheduled workflow scan completed. Triggered ${triggeredCount} workflows, skipped ${skippedRunning} (already running).`,
    );
  } catch (error) {
    console.error('Scheduled workflow scan failed:', error);
    throw error;
  }
}
