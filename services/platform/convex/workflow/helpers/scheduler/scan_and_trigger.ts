/**
 * Helper function to scan for workflows that need to be triggered based on their schedule
 */

import { ActionCtx } from '../../../_generated/server';
import { internal, api } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { getScheduledWorkflows } from './get_scheduled_workflows';
import { getLastExecutionTime } from './get_last_execution_time';
import { shouldTriggerWorkflow } from './should_trigger_workflow';

export async function scanAndTrigger(ctx: ActionCtx): Promise<void> {
  try {
    console.log('Starting scheduled workflow scan...');

    // Get all active workflows with schedule triggers (from first trigger step)
    const scheduled = await ctx.runQuery(
      internal.workflow.scheduler.getScheduledWorkflows,
      {},
    );

    console.log(`Found ${scheduled.length} scheduled workflows`);

    let triggeredCount = 0;

    for (const {
      wfDefinitionId,
      organizationId,
      name,
      schedule,
      timezone,
    } of scheduled) {
      try {
        // Check if workflow should be triggered now (timezone-aware and deduplicated)
        const lastExecutionMs = await ctx.runQuery(
          internal.workflow.scheduler.getLastExecutionTime,
          { wfDefinitionId },
        );

        const shouldTrigger = await shouldTriggerWorkflow(
          schedule,
          timezone || 'UTC',
          typeof lastExecutionMs === 'number' ? lastExecutionMs : null,
        );

        if (shouldTrigger) {
          console.log(
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

    console.log(
      `Scheduled workflow scan completed. Triggered ${triggeredCount} workflows.`,
    );
  } catch (error) {
    console.error('Scheduled workflow scan failed:', error);
    throw error;
  }
}
