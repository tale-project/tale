/**
 * Record a body-step failure into wfExecutions.stepsMap.
 *
 * The catch arm in the dynamic-workflow engine (continueOnError recovery)
 * needs to mark the failed step so that (a) operators can see which
 * iteration broke and (b) subsequent steps reading `steps.<slug>.output`
 * see a failure marker instead of stale data from a prior successful
 * iteration.
 *
 * Pattern mirrors buildStepsMap → persistExecutionResult, but operates on
 * a failure synthesizing a minimal StepExecutionResult so we don't need
 * to invent a new persistence path.
 */

import { isRecord } from '../../../../lib/utils/type-guards';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';
import { toId } from '../../../lib/type_cast_helpers';
import { deserializeVariablesInAction } from '../serialization/deserialize_variables';
import { serializeVariables } from '../serialization/serialize_variables';

export async function recordStepFailure(
  ctx: ActionCtx,
  args: {
    executionId: string;
    stepSlug: string;
    stepName?: string;
    error: string;
  },
): Promise<void> {
  const rawExecution = await ctx.runQuery(
    internal.wf_executions.internal_queries.getRawExecution,
    { executionId: toId<'wfExecutions'>(args.executionId) },
  );

  if (!rawExecution) return;

  let existingVars: Record<string, unknown> = {};
  if (rawExecution.variables) {
    try {
      const parsed: unknown = JSON.parse(rawExecution.variables);
      if (isRecord(parsed) && parsed['_storageRef']) {
        existingVars = await deserializeVariablesInAction(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex context type
          ctx as unknown as {
            storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> };
          },
          rawExecution.variables,
        );
      } else if (isRecord(parsed)) {
        existingVars = parsed;
      }
    } catch {
      existingVars = {};
    }
  }

  const existingSteps = isRecord(existingVars['steps'])
    ? existingVars['steps']
    : {};

  const failureMarker = {
    stepType: 'action',
    name: args.stepName ?? args.stepSlug,
    output: {
      type: 'action',
      data: null,
    },
    port: 'error',
    error: args.error,
    failedAt: Date.now(),
  };

  const merged: Record<string, unknown> = {
    ...existingVars,
    steps: {
      ...existingSteps,
      [args.stepSlug]: failureMarker,
    },
  };

  const oldStorageId = rawExecution.variablesStorageId;
  const { serialized, storageId } = await serializeVariables(
    ctx,
    merged,
    oldStorageId,
  );

  await ctx.runMutation(
    internal.wf_executions.internal_mutations.updateExecutionVariables,
    {
      executionId: toId<'wfExecutions'>(args.executionId),
      variablesSerialized: serialized,
      variablesStorageId: storageId,
    },
  );
}
