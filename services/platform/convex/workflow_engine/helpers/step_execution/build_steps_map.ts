/**
 * Build steps map from execution and result
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { Id } from '../../../_generated/dataModel';
import { StepDefinition, StepExecutionResult } from './types';
import { deserializeVariablesInAction } from '../serialization/deserialize_variables';

export async function buildStepsMap(
  ctx: ActionCtx,
  executionId: string,
  stepDef: StepDefinition,
  result: StepExecutionResult,
): Promise<Record<string, unknown>> {
  // Build the map starting with the current step's output
  const allSteps: Record<string, unknown> = {
    [stepDef.stepSlug]: {
      stepType: stepDef.stepType,
      name: stepDef.name,
      output: result.output,
    },
  };

  // Load existing steps from execution variables, resolving from storage if needed
  const rawExecution = await ctx.runQuery(
    internal.wf_executions.queries.getExecution.getRawExecution,
    {
      executionId: executionId as Id<'wfExecutions'>,
    },
  );

  // Type guard for checking if value is a record
  const isRecord = (val: unknown): val is Record<string, unknown> =>
    val !== null && typeof val === 'object' && !Array.isArray(val);

  let existingVars: Record<string, unknown> = {};
  if (rawExecution?.variables) {
    try {
      const parsed: unknown = JSON.parse(rawExecution.variables);
      if (isRecord(parsed) && parsed['_storageRef']) {
        // Variables are stored in Convex storage, fetch full JSON
        existingVars = await deserializeVariablesInAction(
          ctx as unknown as {
            storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> };
          },
          rawExecution.variables,
        );
      } else if (isRecord(parsed)) {
        existingVars = parsed;
      }
    } catch (_err) {
      // Ignore parse errors; treat as no existing vars
      existingVars = {};
    }
  }

  const stepsFromExisting = isRecord(existingVars['steps'])
    ? existingVars['steps']
    : {};
  // Merge existing steps (excluding current step which we just added)
  for (const [sid, sinfo] of Object.entries(stepsFromExisting)) {
    if (sid !== stepDef.stepSlug) {
      allSteps[sid] = sinfo;
    }
  }

  return allSteps;
}
