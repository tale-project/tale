/**
 * Get execution by ID
 */

import type { QueryCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import type { DeserializedWorkflowExecution } from './types';

export async function getExecution(
  ctx: QueryCtx,
  executionId: Id<'wfExecutions'>,
): Promise<DeserializedWorkflowExecution | null> {
  const execution = await ctx.db.get(executionId);
  if (!execution) {
    return null;
  }

  // Parse variables - if they're in storage, return the storage reference
  // The caller should use an action to fetch the full data if needed
  let variables: Record<string, unknown> = {};
  if (execution.variables) {
    try {
      variables = JSON.parse(execution.variables);
    } catch {
      variables = {};
    }
  }

  return {
    ...execution,
    workflowConfig: execution.workflowConfig
      ? JSON.parse(execution.workflowConfig)
      : {},
    stepsConfig: execution.stepsConfig ? JSON.parse(execution.stepsConfig) : {},
    variables,
  };
}
