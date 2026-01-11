/**
 * On-demand step output fetcher
 *
 * Provides a helper for actions to fetch previous step outputs when needed.
 * This is used when step outputs are excluded from action arguments to stay
 * under Convex's 16 MiB argument limit.
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { Id } from '../../../_generated/dataModel';
import { deserializeVariablesInAction } from '../serialization/deserialize_variables';

export interface StepOutput {
  stepType: string;
  name: string;
  output: unknown;
}

/**
 * Fetch a specific step's output from the execution variables.
 *
 * Use this when an action needs access to a previous step's output but
 * the full steps object was trimmed from action arguments.
 *
 * @param ctx - Action context with storage access
 * @param executionId - The workflow execution ID
 * @param stepSlug - The slug of the step whose output is needed
 * @returns The step output data, or undefined if not found
 */
export async function getStepOutput(
  ctx: ActionCtx,
  executionId: string,
  stepSlug: string,
): Promise<StepOutput | undefined> {
  const rawExecution = await ctx.runQuery(
    internal.wf_executions.getRawExecution,
    {
      executionId: executionId as Id<'wfExecutions'>,
    },
  );

  if (!rawExecution?.variables) {
    return undefined;
  }

  // Deserialize variables (handles both inline JSON and storage references)
  const variables = await deserializeVariablesInAction(
    ctx as unknown as {
      storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> };
    },
    rawExecution.variables,
  );

  const steps = variables.steps as Record<string, StepOutput> | undefined;
  if (!steps || !steps[stepSlug]) {
    return undefined;
  }

  return steps[stepSlug];
}

/**
 * Fetch multiple step outputs at once.
 *
 * More efficient than calling getStepOutput multiple times since it only
 * deserializes the variables once.
 *
 * @param ctx - Action context with storage access
 * @param executionId - The workflow execution ID
 * @param stepSlugs - Array of step slugs whose outputs are needed
 * @returns Map of step slug to output data
 */
export async function getStepOutputs(
  ctx: ActionCtx,
  executionId: string,
  stepSlugs: string[],
): Promise<Record<string, StepOutput>> {
  const rawExecution = await ctx.runQuery(
    internal.wf_executions.getRawExecution,
    {
      executionId: executionId as Id<'wfExecutions'>,
    },
  );

  if (!rawExecution?.variables) {
    return {};
  }

  const variables = await deserializeVariablesInAction(
    ctx as unknown as {
      storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> };
    },
    rawExecution.variables,
  );

  const steps = variables.steps as Record<string, StepOutput> | undefined;
  if (!steps) {
    return {};
  }

  const result: Record<string, StepOutput> = {};
  for (const slug of stepSlugs) {
    if (steps[slug]) {
      result[slug] = steps[slug];
    }
  }

  return result;
}
