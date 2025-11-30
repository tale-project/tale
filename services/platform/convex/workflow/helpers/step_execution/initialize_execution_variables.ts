/**
 * Initialize execution variables
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { Id } from '../../../_generated/dataModel';
import {
  ExecutionData,
  WorkflowConfig,
  InitializeVariablesArgs,
} from './types';
import { decryptAndMergeSecrets } from './decrypt_and_merge_secrets';
import { extractStepsWithOutputs } from './extract_steps_with_outputs';
import { extractLoopVariables } from './extract_loop_variables';
import { serializeVariables } from '../../../workflow/helpers/serialization/serialize_variables';

export async function initializeExecutionVariables(
  ctx: ActionCtx,
  execution: ExecutionData,
  args: InitializeVariablesArgs,
  workflowConfig: WorkflowConfig,
): Promise<Record<string, unknown>> {
  // Determine workflowId: prefer wfDefinitionId, fallback to workflowSlug for inline workflows
  const workflowId = execution.wfDefinitionId ?? execution.workflowSlug;

  let fullVariables: Record<string, unknown> = {
    organizationId: args.organizationId,
    workflowId, // Auto-inject wfDefinitionId or workflowSlug as workflowId
  };

  // Use execution variables as the base, or initialize if empty
  if (execution?.variables && Object.keys(execution.variables).length > 0) {
    fullVariables = {
      ...(execution.variables as Record<string, unknown>),
      organizationId: args.organizationId,
      workflowId, // Auto-inject wfDefinitionId or workflowSlug as workflowId
    };
  } else {
    // Initialize execution variables for the first time
    fullVariables = {
      ...((args.resumeVariables ?? args.initialInput) || {}),
      ...(workflowConfig?.config?.variables ?? {}),
      organizationId: args.organizationId,
      workflowId, // Auto-inject wfDefinitionId or workflowSlug as workflowId
    };

    // Handle secrets decryption for initial setup
    const configSecrets = workflowConfig?.config?.secrets;
    if (configSecrets && Object.keys(configSecrets).length > 0) {
      const inputSecrets =
        (fullVariables.secrets as Record<string, unknown>) || {};
      fullVariables.secrets = await decryptAndMergeSecrets(
        configSecrets,
        inputSecrets,
      );
    }

    // Pre-serialize initial variables in action context
    const { serialized, storageId } = await serializeVariables(
      ctx,
      fullVariables,
    );

    await ctx.runMutation(internal.wf_executions.updateExecutionVariables, {
      executionId: args.executionId as Id<'wfExecutions'>,
      variablesSerialized: serialized,
      variablesStorageId: storageId,
    });
  }

  // Extract steps with outputs and loop variables
  const stepsWithOutputs: Record<string, unknown> = {};
  let latestLoopVariables: Record<string, unknown> | undefined;

  if (execution?.variables) {
    const executionVars = execution.variables as Record<string, unknown>;

    // Extract steps with outputs
    const extractedSteps = extractStepsWithOutputs(executionVars);
    Object.assign(stepsWithOutputs, extractedSteps);

    // Extract loop variables
    latestLoopVariables = extractLoopVariables(extractedSteps, executionVars);

    // Copy other execution variables
    for (const [key, value] of Object.entries(executionVars)) {
      if (key !== 'steps' && key !== 'loop') {
        fullVariables[key] = value;
      }
    }
  }

  // Include loop variables if found
  if (latestLoopVariables) {
    fullVariables.loop = latestLoopVariables;
  }

  fullVariables.steps = stepsWithOutputs;

  return fullVariables;
}
