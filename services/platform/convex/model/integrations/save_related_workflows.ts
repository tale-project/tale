/**
 * Save related workflows when creating an integration
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import type { ConnectionConfig } from './types';
import { getWorkflowsForIntegration } from './get_workflows_for_integration';
import { toPredefinedWorkflowPayload } from '../wf_definitions/types';

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
    const baseConfig = workflow.workflowConfig.config ?? {};

    // Convert predefined workflow to strict API payload types
    const payload = toPredefinedWorkflowPayload(
      workflow,
      {
        config: {
          ...baseConfig,
          variables: {
            ...((baseConfig as { variables?: Record<string, unknown> })
              .variables ?? {}),
            organizationId: args.organizationId,
            // Add integration-specific variables
            ...(args.name === 'shopify' && args.connectionConfig?.domain
              ? { shopifyDomain: args.connectionConfig.domain }
              : {}),
          },
        },
      },
      // Transform trigger steps to enable scheduling
      (step) =>
        step.stepType === 'trigger'
          ? {
              ...step,
              config: {
                type: 'scheduled',
                schedule: schedule.schedule,
                timezone: schedule.timezone,
              },
            }
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
      `Integration Workflows Saved workflow: ${payload.workflowConfig.name} (${result.workflowId})`,
    );
  }

  debugLog(
    `Integration Workflows Successfully saved ${workflowIds.length} workflows for ${args.name}`,
  );

  return workflowIds;
}
