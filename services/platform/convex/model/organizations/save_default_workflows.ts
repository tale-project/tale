/**
 * Save default workflows when creating an organization
 */

import { ActionCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import documentRagSync from '../../predefined_workflows/document_rag_sync';
import onedriveSync from '../../predefined_workflows/onedrive_sync';
import productRagSync from '../../predefined_workflows/product_rag_sync';
import websitePagesRagSync from '../../predefined_workflows/website_pages_rag_sync';
import customerRagSync from '../../predefined_workflows/customer_rag_sync';
import generalCustomerStatusAssessmentWorkflow from '../../predefined_workflows/general_customer_status_assessment';
import generalProductRecommendationWorkflow from '../../predefined_workflows/general_product_recommendation';
import productRecommendationEmailWorkflow from '../../predefined_workflows/product_recommendation_email';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

interface SaveDefaultWorkflowsArgs {
  organizationId: string;
}

/**
 * Save default workflows for a new organization
 *
 * This includes:
 * - Document RAG Sync (scheduled every 20 minutes)
 * - OneDrive Sync (scheduled every hour)
 * - Product RAG Sync (scheduled every 20 minutes)
 * - Website Pages RAG Sync (scheduled every 20 minutes)
 * - Customer RAG Sync (scheduled every 20 minutes)
 */
export async function saveDefaultWorkflows(
  ctx: ActionCtx,
  args: SaveDefaultWorkflowsArgs,
): Promise<Id<'wfDefinitions'>[]> {
  debugLog(
    `Organization Setup Saving default workflows for organization ${args.organizationId}...`,
  );

  const workflowIds: Id<'wfDefinitions'>[] = [];

  // Define workflows to save with their schedules
  const workflowsToSave = [
    {
      workflow: documentRagSync,
      schedule: '*/20 * * * *', // Every 20 minutes
      timezone: 'UTC',
    },
    {
      workflow: onedriveSync,
      schedule: '0 */1 * * *', // Every hour
      timezone: 'UTC',
    },
    {
      workflow: productRagSync,
      schedule: '*/20 * * * *', // Every 20 minutes
      timezone: 'UTC',
    },
    {
      workflow: websitePagesRagSync,
      schedule: '*/20 * * * *', // Every 20 minutes
      timezone: 'UTC',
    },
    {
      workflow: customerRagSync,
      schedule: '*/20 * * * *', // Every 20 minutes
      timezone: 'UTC',
    },
    {
      workflow: generalCustomerStatusAssessmentWorkflow,
      schedule: '0 */6 * * *', // Every 6 hours
      timezone: 'UTC',
    },
    {
      workflow: generalProductRecommendationWorkflow,
      schedule: '0 */12 * * *', // Every 12 hours
      timezone: 'UTC',
    },
    {
      workflow: productRecommendationEmailWorkflow,
      schedule: '0 10 * * *', // Every day at 10 AM
      timezone: 'UTC',
    },
  ];

  for (const { workflow, schedule, timezone } of workflowsToSave) {
    // Update workflow config with organization-specific data
    const workflowConfig = {
      ...(workflow.workflowConfig as unknown as Record<string, unknown>),
      config: {
        ...(workflow.workflowConfig as any).config,
        variables: {
          ...(workflow.workflowConfig as any).config?.variables,
          organizationId: args.organizationId,
        },
      },
    };

    // Update the trigger step to enable scheduling
    const stepsConfig = (workflow.stepsConfig as any[]).map((step) => {
      if (step.stepType === 'trigger') {
        return {
          ...step,
          config: {
            type: 'scheduled',
            schedule: schedule,
            timezone: timezone,
          },
        };
      }
      return step;
    });

    // Save the workflow (creation only)
    const result = await ctx.runMutation(
      internal.wf_definitions.createWorkflowWithSteps,
      {
        organizationId: args.organizationId,
        workflowConfig: workflowConfig as any,
        stepsConfig: stepsConfig as any,
      },
    );

    // Ensure status is active (not draft) for auto-saved workflows
    await ctx.runMutation(internal.wf_definitions.updateWorkflowStatus, {
      wfDefinitionId: result.workflowId,
      status: 'active',
      updatedBy: 'system',
    });

    workflowIds.push(result.workflowId);

    debugLog(
      `Organization Setup Saved workflow: ${(workflowConfig as any).name} (${result.workflowId})`,
    );
  }

  debugLog(
    `Organization Setup Successfully saved ${workflowIds.length} default workflow(s)`,
  );

  return workflowIds;
}
