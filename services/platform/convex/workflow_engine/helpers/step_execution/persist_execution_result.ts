/**
 * Persist execution result to database
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { Id } from '../../../_generated/dataModel';
import { serializeVariables } from '../serialization/serialize_variables';
import { StepDefinition, StepExecutionResult } from './types';

export async function persistExecutionResult(
  ctx: ActionCtx,
  executionId: string,
  baseVariables: Record<string, unknown>,
  result: StepExecutionResult,
  stepDef: StepDefinition,
  stepsMap: Record<string, unknown>,
  essentialLoop?: Record<string, unknown>,
): Promise<void> {
  const merged: Record<string, unknown> = {
    ...baseVariables,
    lastOutput: result.output,
    steps: stepsMap,
    // Merge any variables returned by the step (e.g., from set_variables action)
    ...(result.variables ?? {}),
    // Extract and override loop variable to prevent large payloads and ensure correct loop restoration
    ...(essentialLoop ? { loop: essentialLoop as unknown } : {}),
    organizationId:
      stepDef.organizationId ?? (baseVariables['organizationId'] as unknown),
  };

  // Get current execution to retrieve old storage ID for cleanup
  const currentExecution = await ctx.runQuery(
    internal.wf_executions.queries.getExecution.getRawExecution,
    {
      executionId: executionId as Id<'wfExecutions'>,
    },
  );
  const oldStorageId = currentExecution?.variablesStorageId;

  // Pre-serialize variables in action context so large payloads go to storage
  // Pass oldStorageId to ensure proper cleanup when variables shrink below threshold
  const { serialized, storageId } = await serializeVariables(
    ctx,
    merged,
    oldStorageId,
  );

  await ctx.runMutation(internal.wf_executions.mutations.updateExecution.updateExecutionVariables, {
    executionId: executionId as Id<'wfExecutions'>,
    variablesSerialized: serialized,
    variablesStorageId: storageId,
  });
}
