import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { createDebugLog } from '../lib/debug_log';
import conversationAutoArchiveWorkflow from '../predefined_workflows/conversation_auto_archive';
import documentRagSync from '../predefined_workflows/document_rag_sync';
import generalCustomerStatusAssessmentWorkflow from '../predefined_workflows/general_customer_status_assessment';
import generalProductRecommendationWorkflow from '../predefined_workflows/general_product_recommendation';
import onedriveSync from '../predefined_workflows/onedrive_sync';
import productRecommendationEmailWorkflow from '../predefined_workflows/product_recommendation_email';
import {
  toPredefinedWorkflowPayload,
  type PredefinedWorkflowDefinition,
} from '../workflows/definitions/types';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

interface SaveDefaultWorkflowsArgs {
  organizationId: string;
}

const DEFAULT_WORKFLOWS: Array<{
  workflow: PredefinedWorkflowDefinition;
  schedule: string;
  timezone: string;
}> = [
  { workflow: documentRagSync, schedule: '*/20 * * * *', timezone: 'UTC' },
  { workflow: onedriveSync, schedule: '0 */1 * * *', timezone: 'UTC' },
  {
    workflow: generalCustomerStatusAssessmentWorkflow,
    schedule: '0 */6 * * *',
    timezone: 'UTC',
  },
  {
    workflow: generalProductRecommendationWorkflow,
    schedule: '0 */12 * * *',
    timezone: 'UTC',
  },
  {
    workflow: productRecommendationEmailWorkflow,
    schedule: '0 10 * * *',
    timezone: 'UTC',
  },
  {
    workflow: conversationAutoArchiveWorkflow,
    schedule: '0 0 * * *',
    timezone: 'UTC',
  },
];

export async function saveDefaultWorkflows(
  ctx: ActionCtx,
  args: SaveDefaultWorkflowsArgs,
): Promise<Id<'wfDefinitions'>[]> {
  debugLog(
    `Organization Setup Saving default workflows for organization ${args.organizationId}...`,
  );

  const payloads = DEFAULT_WORKFLOWS.map(({ workflow, schedule, timezone }) => {
    const baseConfig = workflow.workflowConfig.config ?? {};

    return toPredefinedWorkflowPayload(
      workflow,
      {
        config: {
          ...baseConfig,
          variables: {
            ...(isRecord(baseConfig.variables) ? baseConfig.variables : {}),
            organizationId: args.organizationId,
          },
        },
      },
      (step) =>
        step.stepType === 'start' || step.stepType === 'trigger'
          ? {
              ...step,
              config: {
                ...(isRecord(step.config) ? step.config : {}),
                type: 'scheduled',
                schedule,
                timezone,
              },
            }
          : step,
    );
  });

  const results = await Promise.all(
    payloads.map((payload) =>
      ctx.runMutation(
        internal.wf_definitions.internal_mutations.provisionWorkflowWithSteps,
        {
          organizationId: args.organizationId,
          ...payload,
        },
      ),
    ),
  );

  const workflowIds = results.map(
    (r: { workflowId: Id<'wfDefinitions'> }) => r.workflowId,
  );

  await Promise.all(
    workflowIds.map((workflowId: Id<'wfDefinitions'>) =>
      ctx.runMutation(
        internal.wf_definitions.internal_mutations.updateWorkflowStatus,
        {
          wfDefinitionId: workflowId,
          status: 'active',
          updatedBy: 'system',
        },
      ),
    ),
  );

  // Register schedules so the cron scanner picks up these workflows
  await Promise.all(
    DEFAULT_WORKFLOWS.map(({ schedule, timezone }, i) => {
      const workflowId = workflowIds[i];
      if (!workflowId) return Promise.resolve();
      return ctx.runMutation(
        internal.workflows.triggers.internal_mutations.provisionSchedule,
        {
          organizationId: args.organizationId,
          workflowRootId: workflowId,
          cronExpression: schedule,
          timezone,
          createdBy: 'system',
        },
      );
    }),
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
