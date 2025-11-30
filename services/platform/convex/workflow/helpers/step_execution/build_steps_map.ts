/**
 * Build steps map from execution and result
 */

import { ActionCtx } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { Id } from '../../../_generated/dataModel';
import { StepDefinition, StepExecutionResult } from './types';
import { deserializeVariablesInAction } from '../../../workflow/helpers/serialization/deserialize_variables';

export async function buildStepsMap(
  ctx: ActionCtx,
  executionId: string,
  stepDef: StepDefinition,
  result: StepExecutionResult,
): Promise<Record<string, unknown>> {
  // Build the map starting with the current step's output
  const allSteps = {
    [stepDef.stepSlug]: {
      stepType: stepDef.stepType,
      name: stepDef.name,
      output: result.output,
    },
  } as Record<string, unknown>;

  // Load existing steps from execution variables, resolving from storage if needed
  const rawExecution = await ctx.runQuery(
    internal.wf_executions.getRawExecution,
    {
      executionId: executionId as Id<'wfExecutions'>,
    },
  );

  let existingVars: Record<string, unknown> = {};
  if (rawExecution?.variables) {
    try {
      const parsed = JSON.parse(rawExecution.variables) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as Record<string, unknown>)['_storageRef']
      ) {
        // Variables are stored in Convex storage, fetch full JSON
        existingVars = await deserializeVariablesInAction(
          ctx as unknown as {
            storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> };
          },
          rawExecution.variables,
        );
      } else if (parsed && typeof parsed === 'object') {
        existingVars = parsed as Record<string, unknown>;
      }
    } catch (_err) {
      // Ignore parse errors; treat as no existing vars
      existingVars = {};
    }
  }

  const stepsFromExisting = (existingVars['steps'] ?? {}) as Record<
    string,
    unknown
  >;
  if (stepsFromExisting && typeof stepsFromExisting === 'object') {
    for (const [sid, sinfo] of Object.entries(stepsFromExisting)) {
      if (sid !== stepDef.stepSlug) {
        allSteps[sid] = sinfo;
      }
    }
  }

  return allSteps;
}
