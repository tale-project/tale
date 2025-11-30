/**
 * Save related workflows when creating an email provider
 */

import { ActionCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';

// Import workflow definitions
import emailSyncImap from '../../predefined_workflows/email_sync_imap';
import conversationAutoReply from '../../predefined_workflows/conversation_auto_reply';

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
  console.log(
    `[Email Provider Workflows] Saving workflows for ${args.accountEmail}...`,
  );

  const workflowIds: Id<'wfDefinitions'>[] = [];

  const workflowsToSave = [
    {
      def: emailSyncImap,
      schedule: '*/5 * * * *',
      timezone: 'UTC',
      addAccountEmail: true,
    },
    {
      def: conversationAutoReply,
      schedule: '*/10 * * * *',
      timezone: 'UTC',
      addAccountEmail: false,
    },
  ];

  for (const { def, schedule, timezone, addAccountEmail } of workflowsToSave) {
    const baseWorkflowConfig = def.workflowConfig as any;
    const workflowName = baseWorkflowConfig.name as string;

    // If a workflow with this name already exists for the organization, reuse it
    const existingWorkflow = await ctx.runQuery(
      internal.wf_definitions.getWorkflowByName,
      {
        organizationId: args.organizationId,
        name: workflowName,
      },
    );

    if (existingWorkflow) {
      console.log(
        `[Email Provider Workflows] Workflow with name "${workflowName}" already exists, reusing ${(existingWorkflow as any)._id}`,
      );
      workflowIds.push((existingWorkflow as any)._id as Id<'wfDefinitions'>);
      continue;
    }

    // Update workflow config with organization-specific data
    const workflowConfig = {
      ...baseWorkflowConfig,
      config: {
        ...(baseWorkflowConfig.config as any),
        variables: {
          ...(baseWorkflowConfig.config?.variables ?? {}),
          organizationId: args.organizationId,
          ...(addAccountEmail ? { accountEmail: args.accountEmail } : {}),
        },
      },
    };

    // Update the trigger step to enable scheduling
    const stepsConfig = (def.stepsConfig as any[]).map((step) => {
      if (step.stepType === 'trigger') {
        return {
          ...step,
          config: {
            type: 'scheduled',
            schedule,
            timezone,
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

    console.log(
      `[Email Provider Workflows] Saved workflow: ${(workflowConfig as any).name} (${result.workflowId})`,
    );
  }

  console.log(
    `[Email Provider Workflows] Successfully saved ${workflowIds.length} workflow(s)`,
  );

  return workflowIds;
}
