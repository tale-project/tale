/**
 * Save related workflows when creating an integration
 */

import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import type { ConnectionConfig } from './types';
import { getWorkflowsForIntegration } from './get_workflows_for_integration';
import { toPredefinedWorkflowPayload } from '../workflows/definitions/types';

import { createDebugLog } from '../lib/debug_log';

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

  // Prepare all workflow payloads
  const payloads = workflows.map((workflow, i) => {
    const schedule = schedules[i];
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
  });

  // Create all workflows in parallel
  const results = await Promise.all(
    payloads.map((payload) =>
      ctx.runMutation(internal.wf_definitions.internal_mutations.provisionWorkflowWithSteps, {
        organizationId: args.organizationId,
        ...payload,
      }),
    ),
  );

  const workflowIds = results.map((r: { workflowId: Id<'wfDefinitions'> }) => r.workflowId);

  // Activate all workflows in parallel
  await Promise.all(
    workflowIds.map((workflowId: Id<'wfDefinitions'>) =>
      ctx.runMutation(internal.wf_definitions.internal_mutations.updateWorkflowStatus, {
        wfDefinitionId: workflowId,
        status: 'active',
        updatedBy: 'system',
      }),
    ),
  );

  for (let i = 0; i < payloads.length; i++) {
    debugLog(
      `Integration Workflows Saved workflow: ${payloads[i].workflowConfig.name} (${workflowIds[i]})`,
    );
  }

  debugLog(
    `Integration Workflows Successfully saved ${workflowIds.length} workflows for ${args.name}`,
  );

  return workflowIds;
}
