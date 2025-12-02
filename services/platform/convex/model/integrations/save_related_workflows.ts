/**
 * Save related workflows when creating an integration
 */

import { ActionCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import { ConnectionConfig } from './types';
import { getWorkflowsForIntegration } from './get_workflows_for_integration';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATIONS', '[Integrations]');

interface SaveRelatedWorkflowsArgs {
  organizationId: string;
  name: string;
  connectionConfig?: ConnectionConfig;
}

/**
 * Save related workflows for an integration
 */
export async function saveRelatedWorkflows(
  ctx: ActionCtx,
  args: SaveRelatedWorkflowsArgs,
): Promise<Id<'wfDefinitions'>[]> {
  debugLog(
    `Integration Workflows Saving related workflows for ${args.name}...`,
  );

  const { workflows, schedules } = getWorkflowsForIntegration(args.name);

  if (workflows.length === 0) {
    debugLog(`Integration Workflows No predefined workflows for ${args.name}`);
    return [];
  }

  const workflowIds: Id<'wfDefinitions'>[] = [];

  for (let i = 0; i < workflows.length; i++) {
    const workflow = workflows[i];
    const schedule = schedules[i];

    // Update workflow config with organization-specific data
    const workflowConfig = {
      ...(workflow.workflowConfig as unknown as Record<string, unknown>),
      config: {
        ...(workflow.workflowConfig as any).config,
        variables: {
          ...(workflow.workflowConfig as any).config?.variables,
          organizationId: args.organizationId,
          // Add integration-specific variables
          ...(args.name === 'shopify' && args.connectionConfig?.domain
            ? { shopifyDomain: args.connectionConfig.domain }
            : {}),
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
            schedule: schedule.schedule,
            timezone: schedule.timezone,
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
      `Integration Workflows Saved workflow: ${(workflowConfig as any).name} (${result.workflowId})`,
    );
  }

  debugLog(
    `Integration Workflows Successfully saved ${workflowIds.length} workflows for ${args.name}`,
  );

  return workflowIds;
}
