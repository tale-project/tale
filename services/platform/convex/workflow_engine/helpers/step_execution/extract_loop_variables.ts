/**
 * Extract loop variables from steps data and execution variables
 */

import { isRecord } from '../../../../lib/utils/type-guards';

export function extractLoopVariables(
  stepsData: Record<string, unknown>,
  executionVars: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let latestLoopVariables: Record<string, unknown> | undefined;

  // Extract loop variables from step outputs
  for (const [, stepInfo] of Object.entries(stepsData)) {
    if (!isRecord(stepInfo)) {
      continue;
    }

    // Check if this is a loop step with output data
    if (stepInfo.stepType !== 'loop' || !isRecord(stepInfo.output)) {
      continue;
    }

    const stepOutput = stepInfo.output;
    if (!isRecord(stepOutput.data)) {
      continue;
    }

    const loopData = stepOutput.data;
    if (!loopData.item && !loopData.state) {
      continue;
    }

    latestLoopVariables = {
      item: loopData.item,
      state: loopData.state,
      index: isRecord(loopData.state) ? loopData.state.currentIndex : undefined,
    };
  }

  // Also check for existing loop variables in execution variables
  if (isRecord(executionVars.loop)) {
    latestLoopVariables = executionVars.loop;
  }

  return latestLoopVariables;
}
