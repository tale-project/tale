/**
 * Serialize and Complete Execution Handler
 *
 * Action handler that serializes large output to storage before completing execution.
 * This is necessary because mutations cannot use ctx.storage.store().
 */

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';

import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { serializeOutput } from '../serialization/serialize_output';
import { serializeVariables } from '../serialization/serialize_variables';
import { stripTransientVariables } from '../serialization/strip_transient_variables';

const debugLog = createDebugLog('DEBUG_WORKFLOW', '[Workflow]');

export interface SerializeAndCompleteExecutionArgs {
  executionId: Id<'wfExecutions'>;
}

export async function handleSerializeAndCompleteExecution(
  ctx: ActionCtx,
  args: SerializeAndCompleteExecutionArgs,
): Promise<null> {
  debugLog('serializeAndCompleteExecution Starting', {
    executionId: args.executionId,
  });

  // Get current execution to retrieve variables and existing storage IDs
  const execution = await ctx.runQuery(
    internal.wf_executions.internal_queries.getRawExecution,
    { executionId: args.executionId },
  );

  if (!execution) {
    throw new Error(`Execution not found: ${args.executionId}`);
  }

  // Parse variables to use as output
  let output: unknown = {};
  if (execution.variables) {
    try {
      output = JSON.parse(execution.variables);
    } catch {
      output = {};
    }
  }

  // Serialize output to storage if needed
  const { serialized: outputSerialized, storageId: outputStorageId } =
    await serializeOutput(ctx, output, execution.outputStorageId);

  // Parse the serialized output back to JSON for the mutation
  const outputParsed = JSON.parse(outputSerialized);

  // Strip transient keys (lastOutput, steps) from variables before persisting
  const parsedVars: Record<string, unknown> =
    typeof output === 'object' && output !== null && !Array.isArray(output)
      ? Object.fromEntries(Object.entries(output))
      : {};
  const strippedVars = stripTransientVariables(parsedVars);
  const { serialized: varsSerialized, storageId: varsStorageId } =
    await serializeVariables(ctx, strippedVars, execution.variablesStorageId);

  debugLog('serializeAndCompleteExecution Serialized output', {
    hasStorageId: !!outputStorageId,
    outputSize: outputSerialized.length,
    strippedVarsSize: varsSerialized.length,
  });

  // Call the mutation with pre-serialized data
  await ctx.runMutation(
    internal.wf_executions.internal_mutations.completeExecution,
    {
      executionId: args.executionId,
      output: outputParsed,
      outputStorageId,
      variablesSerialized: varsSerialized,
      variablesStorageId: varsStorageId,
    },
  );

  debugLog('serializeAndCompleteExecution Completed', {
    executionId: args.executionId,
  });

  return null;
}
