/**
 * Helper function to scan for workflows that need to be triggered based on their schedule
 */

import { ActionCtx } from '../../../_generated/server';
import { internal, api } from '../../../_generated/api';
import { shouldTriggerWorkflow } from './should_trigger_workflow';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export async function scanAndTrigger(ctx: ActionCtx): Promise<void> {
  try {
    debugLog('Starting scheduled workflow scan...');

    // Get all active workflows with schedule triggers (from first trigger step)
    const scheduled = await ctx.runQuery(
      internal.workflow.scheduler.getScheduledWorkflows,
      {},
    );

    debugLog(`Found ${scheduled.length} scheduled workflows`);

    // OPTIMIZATION: Batch load last execution times for all scheduled workflows
    // to avoid N+1 query problem
    const wfDefinitionIds = scheduled.map((wf) => wf.wfDefinitionId);
    const lastExecutionTimesObj = await ctx.runQuery(
      internal.workflow.scheduler.getLastExecutionTimes,
      { wfDefinitionIds },
    );

    let triggeredCount = 0;

    for (const {
      wfDefinitionId,
      organizationId,
      name,
      schedule,
      timezone,
    } of scheduled) {
      try {
        // Get last execution time from batch-loaded object (serialized Map)
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

          // Start workflow execution using the engine executor directly
          await ctx.runMutation(api.workflow.engine.startWorkflow, {
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

          triggeredCount++;
        }
      } catch (error) {
        console.error(`Failed to trigger workflow ${wfDefinitionId}:`, error);
        // Continue with other workflows even if one fails
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
