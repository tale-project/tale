/**
 * Extract loop variables from steps data and execution variables
 */

export function extractLoopVariables(
  stepsData: Record<string, unknown>,
  executionVars: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let latestLoopVariables: Record<string, unknown> | undefined;

  // Extract loop variables from step outputs
  for (const [, stepInfo] of Object.entries(stepsData)) {
    if (!stepInfo || typeof stepInfo !== 'object') {
      continue;
    }

    const step = stepInfo as Record<string, unknown>;

    // Check if this is a loop step with output data
    if (
      step.stepType !== 'loop' ||
      !step.output ||
      typeof step.output !== 'object'
    ) {
      continue;
    }

    const stepOutput = step.output as Record<string, unknown>;
    if (!stepOutput.data || typeof stepOutput.data !== 'object') {
      continue;
    }

    const loopData = stepOutput.data as Record<string, unknown>;
    if (!loopData.item && !loopData.state) {
      continue;
    }

    latestLoopVariables = {
      item: loopData.item,
      state: loopData.state,
      index: (loopData.state as Record<string, unknown>)?.currentIndex,
    };
  }

  // Also check for existing loop variables in execution variables
  if (executionVars.loop) {
    latestLoopVariables = executionVars.loop as Record<string, unknown>;
  }

  return latestLoopVariables;
}
