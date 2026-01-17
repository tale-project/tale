/**
 * Merge execution variables with steps and loop data
 */

export function mergeExecutionVariables(
  baseVariables: Record<string, unknown>,
  stepsWithOutputs: Record<string, unknown>,
  loopVariables?: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...baseVariables,
    steps: stepsWithOutputs,
  };

  // Include loop variables if found
  if (loopVariables) {
    merged.loop = loopVariables;
  }

  return merged;
}
