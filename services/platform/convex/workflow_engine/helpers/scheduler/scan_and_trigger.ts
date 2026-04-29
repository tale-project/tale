/**
 * Helper function to scan for workflows that need to be triggered based on their schedule.
 * Reads from the wfSchedules table via getScheduledWorkflows.
 */

import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { ActionCtx } from '../../../_generated/server';
import { createDebugLog } from '../../../lib/debug_log';
import type { ConvexJsonRecord } from '../../../lib/validators/json';
import { resolveOrgSlug } from '../../../organizations/resolve_org_slug';
import { shouldTriggerWorkflow } from './should_trigger_workflow';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

interface ScheduledWorkflow {
  workflowSlug: string;
  organizationId: string;
  name: string;
  schedule: string;
  timezone: string;
  scheduleId: Id<'wfSchedules'>;
  variables?: ConvexJsonRecord;
}

export async function scanAndTrigger(ctx: ActionCtx): Promise<void> {
  try {
    debugLog('Starting scheduled workflow scan...');

    const scheduled = (await ctx.runQuery(
      internal.workflow_engine.internal_queries.getScheduledWorkflows,
      {},
    )) as ScheduledWorkflow[];

    debugLog(`Found ${scheduled.length} scheduled workflows`);

    const workflowSlugs = scheduled.map(
      (wf: ScheduledWorkflow) => wf.workflowSlug,
    );
    const lastExecutionTimesObj = await ctx.runQuery(
      internal.workflow_engine.internal_queries.getLastExecutionTimes,
      { wfDefinitionIds: workflowSlugs },
    );

    const runningExecutionsObj = (await ctx.runQuery(
      internal.workflow_engine.internal_queries.getRunningExecutions,
      { wfDefinitionIds: workflowSlugs },
    )) as Record<string, boolean>;

    let triggeredCount = 0;
    let skippedRunning = 0;

    for (const {
      workflowSlug,
      organizationId,
      name,
      schedule,
      timezone,
      scheduleId,
      variables,
    } of scheduled) {
      try {
        if (runningExecutionsObj[workflowSlug]) {
          debugLog(
            `Skipping workflow (already running): ${name} (${workflowSlug})`,
          );
          skippedRunning++;
          continue;
        }

        const lastExecutionMs = lastExecutionTimesObj[workflowSlug];

        const shouldTrigger = await shouldTriggerWorkflow(
          schedule,
          timezone,
          typeof lastExecutionMs === 'number' ? lastExecutionMs : null,
        );

        if (shouldTrigger) {
          debugLog(`Triggering scheduled workflow: ${name} (${workflowSlug})`);

          const orgSlug = await resolveOrgSlug(ctx, organizationId);

          await ctx.runAction(
            internal.workflow_engine.helpers.engine.start_workflow_from_file
              .startWorkflowFromFile,
            {
              organizationId,
              orgSlug,
              workflowSlug,
              input: variables ?? {},
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
        console.error(`Failed to trigger workflow ${workflowSlug}:`, error);
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
