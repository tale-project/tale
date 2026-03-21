/**
 * Serialize Execution Output Handler
 *
 * Action handler that serializes large output and variables to storage.
 * This is necessary because mutations cannot use ctx.storage.store().
 *
 * This action only persists data — it does NOT set the execution to completed.
 * The component callback (onWorkflowComplete) is the sole authority for
 * transitioning status to 'completed'.
 */

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';

import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { deserializeVariablesInAction } from '../serialization/deserialize_variables';
import { serializeOutput } from '../serialization/serialize_output';
import { serializeVariables } from '../serialization/serialize_variables';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export interface SerializeExecutionOutputArgs {
  executionId: Id<'wfExecutions'>;
}

export async function handleSerializeExecutionOutput(
  ctx: ActionCtx,
  args: SerializeExecutionOutputArgs,
): Promise<null> {
  debugLog('serializeExecutionOutput Starting', {
    executionId: args.executionId,
  });

  const execution = await ctx.runQuery(
    internal.wf_executions.internal_queries.getRawExecution,
    { executionId: args.executionId },
  );

  if (!execution) {
    throw new Error(`Execution not found: ${args.executionId}`);
  }

  // Deserialize variables (may fetch from blob storage)
  let vars: Record<string, unknown> = {};
  if (execution.variables) {
    try {
      vars = await deserializeVariablesInAction(ctx, execution.variables);
    } catch {
      vars = {};
    }
  }

  // Extract output: use output node's __workflowOutput if present.
  // __workflowOutput is stored under the variables namespace by persistExecutionResult.
  // When no output node exists, output is null — variables are stored separately.
  const nestedVars = isRecord(vars.variables) ? vars.variables : vars;
  const output: unknown =
    '__workflowOutput' in nestedVars ? nestedVars.__workflowOutput : null;

  // Serialize output to storage if needed
  const { serialized: outputSerialized, storageId: outputStorageId } =
    await serializeOutput(ctx, output, execution.outputStorageId);
  const outputParsed = JSON.parse(outputSerialized);

  // Serialize FULL variables (minus __workflowOutput and sensitive keys)
  const sanitizedVars = sanitizeVariablesForStorage(vars);
  const { serialized: varsSerialized, storageId: varsStorageId } =
    await serializeVariables(ctx, sanitizedVars, execution.variablesStorageId);

  debugLog('serializeExecutionOutput Serialized', {
    hasOutputStorageId: !!outputStorageId,
    outputSize: outputSerialized.length,
    varsSize: varsSerialized.length,
  });

  // Persist output and variables separately — do NOT change execution status
  await ctx.runMutation(
    internal.wf_executions.internal_mutations.persistExecutionOutput,
    {
      executionId: args.executionId,
      output: outputParsed,
      outputStorageId,
    },
  );

  await ctx.runMutation(
    internal.wf_executions.internal_mutations.updateExecutionVariables,
    {
      executionId: args.executionId,
      variablesSerialized: varsSerialized,
      variablesStorageId: varsStorageId,
    },
  );

  debugLog('serializeExecutionOutput Completed', {
    executionId: args.executionId,
  });

  return null;
}

const SENSITIVE_KEYS = [
  'secrets',
  'organizationId',
  'wfDefinitionId',
  'rootWfDefinitionId',
];

function sanitizeVariablesForStorage(
  vars: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned = { ...vars };
  delete cleaned.__workflowOutput;
  // Also clean __workflowOutput from nested variables namespace
  if (isRecord(cleaned.variables)) {
    const nestedCleaned = { ...cleaned.variables };
    delete nestedCleaned.__workflowOutput;
    cleaned.variables = nestedCleaned;
  }
  for (const key of SENSITIVE_KEYS) {
    delete cleaned[key];
  }
  return cleaned;
}
