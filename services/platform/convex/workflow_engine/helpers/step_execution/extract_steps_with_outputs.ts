/**
 * Extract steps with outputs from execution variables
 */

export function extractStepsWithOutputs(
  executionVars: Record<string, unknown>,
): Record<string, unknown> {
  const stepsWithOutputs: Record<string, unknown> = {};

  // Use existing steps data from execution variables
  if (!executionVars.steps || typeof executionVars.steps !== 'object') {
    return stepsWithOutputs;
  }

  const stepsData = executionVars.steps as Record<string, unknown>;

  // Copy all step data
  for (const [stepSlug, stepInfo] of Object.entries(stepsData)) {
    if (stepInfo && typeof stepInfo === 'object') {
      stepsWithOutputs[stepSlug] = stepInfo;
    }
  }

  return stepsWithOutputs;
}
