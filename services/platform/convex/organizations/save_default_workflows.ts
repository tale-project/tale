/**
 * Save default workflows when creating an organization
 */

import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import documentRagSync from '../../predefined_workflows/document_rag_sync';
import onedriveSync from '../../predefined_workflows/onedrive_sync';
import generalCustomerStatusAssessmentWorkflow from '../../predefined_workflows/general_customer_status_assessment';
import generalProductRecommendationWorkflow from '../../predefined_workflows/general_product_recommendation';
import productRecommendationEmailWorkflow from '../../predefined_workflows/product_recommendation_email';
import conversationAutoArchiveWorkflow from '../../predefined_workflows/conversation_auto_archive';
import {
  toPredefinedWorkflowPayload,
  type PredefinedWorkflowDefinition,
} from '../wf_definitions/types';

import { createDebugLog } from '../lib/debug_log';

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
 */
export async function saveDefaultWorkflows(
  ctx: ActionCtx,
  args: SaveDefaultWorkflowsArgs,
): Promise<Id<'wfDefinitions'>[]> {
  debugLog(
    `Organization Setup Saving default workflows for organization ${args.organizationId}...`,
  );

  // Define workflows to save with their schedules
  const workflowsToSave: Array<{
    workflow: PredefinedWorkflowDefinition;
    schedule: string;
    timezone: string;
  }> = [
    {
      workflow: documentRagSync as PredefinedWorkflowDefinition,
      schedule: '*/20 * * * *', // Every 20 minutes
      timezone: 'UTC',
    },
    {
      workflow: onedriveSync as PredefinedWorkflowDefinition,
      schedule: '0 */1 * * *', // Every hour
      timezone: 'UTC',
    },
    {
      workflow: generalCustomerStatusAssessmentWorkflow as PredefinedWorkflowDefinition,
      schedule: '0 */6 * * *', // Every 6 hours
      timezone: 'UTC',
    },
    {
      workflow: generalProductRecommendationWorkflow as PredefinedWorkflowDefinition,
      schedule: '0 */12 * * *', // Every 12 hours
      timezone: 'UTC',
    },
    {
      workflow: productRecommendationEmailWorkflow as PredefinedWorkflowDefinition,
      schedule: '0 10 * * *', // Every day at 10 AM
      timezone: 'UTC',
    },
    {
      workflow: conversationAutoArchiveWorkflow as PredefinedWorkflowDefinition,
      schedule: '0 0 * * *', // Daily at midnight
      timezone: 'UTC',
    },
  ];

  // Prepare all workflow payloads
  const payloads = workflowsToSave.map(({ workflow, schedule, timezone }) => {
    const baseConfig = workflow.workflowConfig.config ?? {};

    return toPredefinedWorkflowPayload(
      workflow,
      {
        config: {
          ...baseConfig,
          variables: {
            ...((baseConfig as { variables?: Record<string, unknown> })
              .variables ?? {}),
            organizationId: args.organizationId,
          },
        },
      },
      // Transform trigger steps to enable scheduling
      (step) =>
        step.stepType === 'trigger'
          ? { ...step, config: { type: 'scheduled', schedule, timezone } }
          : step,
    );
  });

  // Create all workflows in parallel
  const results = await Promise.all(
    payloads.map((payload) =>
      ctx.runMutation(internal.wf_definitions.mutations.createWorkflow.createWorkflowWithSteps, {
        organizationId: args.organizationId,
        ...payload,
      }),
    ),
  );

  const workflowIds = results.map((r) => r.workflowId);

  // Activate all workflows in parallel
  await Promise.all(
    workflowIds.map((workflowId) =>
      ctx.runMutation(internal.wf_definitions.mutations.updateWorkflow.updateWorkflowStatus, {
        wfDefinitionId: workflowId,
        status: 'active',
        updatedBy: 'system',
      }),
    ),
  );

  for (let i = 0; i < payloads.length; i++) {
    debugLog(
      `Organization Setup Saved workflow: ${payloads[i].workflowConfig.name} (${workflowIds[i]})`,
    );
  }

  debugLog(
    `Organization Setup Successfully saved ${workflowIds.length} default workflow(s)`,
  );

  return workflowIds;
}
