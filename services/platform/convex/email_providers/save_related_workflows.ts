/**
 * Save related workflows when creating an email provider
 */

import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import {
  toPredefinedWorkflowPayload,
  type PredefinedWorkflowDefinition,
} from '../workflows/definitions/types';

// Import workflow definitions
import emailSyncImap from '../predefined_workflows/email_sync_imap';
import conversationAutoReply from '../predefined_workflows/conversation_auto_reply';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_EMAIL', '[Email]');

interface SaveRelatedWorkflowsArgs {
  organizationId: string;
  accountEmail?: string; // Optional - not used by workflows, they query default provider dynamically
}

/**
 * Save email sync workflow for an email provider
 */
export async function saveRelatedWorkflows(
  ctx: ActionCtx,
  args: SaveRelatedWorkflowsArgs,
): Promise<Id<'wfDefinitions'>[]> {
  debugLog(
    `Email Provider Workflows Saving workflows for org ${args.organizationId}...`,
  );

  const workflowIds: Id<'wfDefinitions'>[] = [];

  const workflowsToSave: Array<{
    def: PredefinedWorkflowDefinition;
    schedule: string;
    timezone: string;
    addAccountEmail: boolean;
  }> = [
    {
      def: emailSyncImap,
      schedule: '*/5 * * * *',
      timezone: 'UTC',
      addAccountEmail: false,
    },
    {
      def: conversationAutoReply,
      schedule: '*/10 * * * *',
      timezone: 'UTC',
      addAccountEmail: false,
    },
  ];

  // Check all existing workflows in parallel
  const existingWorkflows = await Promise.all(
    workflowsToSave.map(({ def }) =>
      ctx.runQuery(internal.wf_definitions.internal_queries.getWorkflowByName, {
        organizationId: args.organizationId,
        name: def.workflowConfig.name,
      }),
    ),
  );

  // Separate into existing (reuse) and new (create)
  const toCreate: Array<{
    def: PredefinedWorkflowDefinition;
    schedule: string;
    timezone: string;
    addAccountEmail: boolean;
  }> = [];

  for (let i = 0; i < workflowsToSave.length; i++) {
    const existing = existingWorkflows[i];
    const workflowDef = workflowsToSave[i];

    if (existing) {
      debugLog(
        `Email Provider Workflows Workflow with name "${workflowDef.def.workflowConfig.name}" already exists, reusing ${existing._id}`,
      );
      workflowIds.push(existing._id);
    } else {
      toCreate.push(workflowDef);
    }
  }

  if (toCreate.length > 0) {
    // Prepare payloads for workflows to create
    const payloads = toCreate.map(({ def, schedule, timezone, addAccountEmail }) => {
      const baseConfig = def.workflowConfig.config ?? {};
      return toPredefinedWorkflowPayload(
        def,
        {
          config: {
            ...baseConfig,
            variables: {
              ...((baseConfig as { variables?: Record<string, unknown> })
                .variables ?? {}),
              organizationId: args.organizationId,
              ...(addAccountEmail && args.accountEmail ? { accountEmail: args.accountEmail } : {}),
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

    // Create all new workflows in parallel
    const results = await Promise.all(
      payloads.map((payload) =>
        ctx.runMutation(internal.wf_definitions.internal_mutations.provisionWorkflowWithSteps, {
          organizationId: args.organizationId,
          ...payload,
        }),
      ),
    );

    const newWorkflowIds = results.map((r: { workflowId: Id<'wfDefinitions'> }) => r.workflowId);

    // Activate all new workflows in parallel
    await Promise.all(
      newWorkflowIds.map((workflowId: Id<'wfDefinitions'>) =>
        ctx.runMutation(internal.wf_definitions.internal_mutations.updateWorkflowStatus, {
          wfDefinitionId: workflowId,
          status: 'active',
          updatedBy: 'system',
        }),
      ),
    );

    for (let i = 0; i < payloads.length; i++) {
      debugLog(
        `Email Provider Workflows Saved workflow: ${payloads[i].workflowConfig.name} (${newWorkflowIds[i]})`,
      );
    }

    workflowIds.push(...newWorkflowIds);
  }

  debugLog(
    `Email Provider Workflows Successfully saved ${workflowIds.length} workflow(s)`,
  );

  return workflowIds;
}
