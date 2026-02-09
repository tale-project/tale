/**
 * Initialize execution variables
 */

import { internal } from '../../../_generated/api';
import { Id } from '../../../_generated/dataModel';
import { ActionCtx } from '../../../_generated/server';
import { serializeVariables } from '../serialization/serialize_variables';
import { decryptAndMergeSecrets } from './decrypt_and_merge_secrets';
import { extractLoopVariables } from './extract_loop_variables';
import { extractStepsWithOutputs } from './extract_steps_with_outputs';
import {
  ExecutionData,
  WorkflowConfig,
  InitializeVariablesArgs,
} from './types';

export async function initializeExecutionVariables(
  ctx: ActionCtx,
  execution: ExecutionData,
  args: InitializeVariablesArgs,
  workflowConfig: WorkflowConfig,
): Promise<Record<string, unknown>> {
  // Determine wfDefinitionId: prefer wfDefinitionId, fallback to workflowSlug for inline workflows
  const wfDefinitionId = execution.wfDefinitionId ?? execution.workflowSlug;
  // rootWfDefinitionId: root version of the workflow family (for tracking across versions)
  const rootWfDefinitionId = execution.rootWfDefinitionId;

  let fullVariables: Record<string, unknown> = {
    organizationId: args.organizationId,
    wfDefinitionId, // Auto-inject wfDefinitionId or workflowSlug
    rootWfDefinitionId, // Auto-inject root workflow definition ID
  };

  // Use execution variables as the base, or initialize if empty
  if (execution?.variables && Object.keys(execution.variables).length > 0) {
    fullVariables = {
      ...(execution.variables as Record<string, unknown>),
      organizationId: args.organizationId,
      wfDefinitionId, // Auto-inject wfDefinitionId or workflowSlug
      rootWfDefinitionId, // Auto-inject root workflow definition ID
    };
  } else {
    // Initialize execution variables for the first time
    fullVariables = {
      ...((args.resumeVariables ?? args.initialInput) as Record<string, unknown>),
      ...workflowConfig?.config?.variables,
      organizationId: args.organizationId,
      wfDefinitionId, // Auto-inject wfDefinitionId or workflowSlug
      rootWfDefinitionId, // Auto-inject root workflow definition ID
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

    await ctx.runMutation(
      internal.wf_executions.internal_mutations.updateExecutionVariables,
      {
        executionId: args.executionId as Id<'wfExecutions'>,
        variablesSerialized: serialized,
        variablesStorageId: storageId,
      },
    );
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
