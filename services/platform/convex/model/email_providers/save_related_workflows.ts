/**
 * Save related workflows when creating an email provider
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import {
  toPredefinedWorkflowPayload,
  type PredefinedWorkflowDefinition,
} from '../wf_definitions/types';

// Import workflow definitions
import emailSyncImap from '../../predefined_workflows/email_sync_imap';
import conversationAutoReply from '../../predefined_workflows/conversation_auto_reply';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

interface SaveRelatedWorkflowsArgs {
  organizationId: string;
  accountEmail: string; // The email address for this provider
}

/**
 * Save email sync workflow for an email provider
 */
export async function saveRelatedWorkflows(
  ctx: ActionCtx,
  args: SaveRelatedWorkflowsArgs,
): Promise<Id<'wfDefinitions'>[]> {
  debugLog(
    `Email Provider Workflows Saving workflows for ${args.accountEmail}...`,
  );

  const workflowIds: Id<'wfDefinitions'>[] = [];

  const workflowsToSave: Array<{
    def: PredefinedWorkflowDefinition;
    schedule: string;
    timezone: string;
    addAccountEmail: boolean;
  }> = [
    {
      def: emailSyncImap as PredefinedWorkflowDefinition,
      schedule: '*/5 * * * *',
      timezone: 'UTC',
      addAccountEmail: true,
    },
    {
      def: conversationAutoReply as PredefinedWorkflowDefinition,
      schedule: '*/10 * * * *',
      timezone: 'UTC',
      addAccountEmail: false,
    },
  ];

  for (const { def, schedule, timezone, addAccountEmail } of workflowsToSave) {
    const baseWorkflowConfig = def.workflowConfig;
    const workflowName = baseWorkflowConfig.name;

    // If a workflow with this name already exists for the organization, reuse it
    const existingWorkflow = await ctx.runQuery(
      internal.wf_definitions.getWorkflowByName,
      {
        organizationId: args.organizationId,
        name: workflowName,
      },
    );

    if (existingWorkflow) {
      debugLog(
        `Email Provider Workflows Workflow with name "${workflowName}" already exists, reusing ${existingWorkflow._id}`,
      );
      workflowIds.push(existingWorkflow._id);
      continue;
    }

    // Convert predefined workflow to strict API payload types
    const baseConfig = baseWorkflowConfig.config ?? {};
    const payload = toPredefinedWorkflowPayload(
      def,
      {
        config: {
          ...baseConfig,
          variables: {
            ...((baseConfig as { variables?: Record<string, unknown> })
              .variables ?? {}),
            organizationId: args.organizationId,
            ...(addAccountEmail ? { accountEmail: args.accountEmail } : {}),
          },
        },
      },
      // Transform trigger steps to enable scheduling
      (step) =>
        step.stepType === 'trigger'
          ? { ...step, config: { type: 'scheduled', schedule, timezone } }
          : step,
    );

    // Save the workflow
    const result = await ctx.runMutation(
      internal.wf_definitions.createWorkflowWithSteps,
      {
        organizationId: args.organizationId,
        ...payload,
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
      `Email Provider Workflows Saved workflow: ${payload.workflowConfig.name} (${result.workflowId})`,
    );
  }

  debugLog(
    `Email Provider Workflows Successfully saved ${workflowIds.length} workflow(s)`,
  );

  return workflowIds;
}
