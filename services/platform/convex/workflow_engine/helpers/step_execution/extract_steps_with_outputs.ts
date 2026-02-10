/**
 * Extract steps with outputs from execution variables
 */

import { isRecord } from '../../../../lib/utils/type-guards';

export function extractStepsWithOutputs(
  executionVars: Record<string, unknown>,
): Record<string, unknown> {
  const stepsWithOutputs: Record<string, unknown> = {};

  // Use existing steps data from execution variables
  if (!isRecord(executionVars.steps)) {
    return stepsWithOutputs;
  }

  const stepsData = executionVars.steps;

  // Copy all step data
  for (const [stepSlug, stepInfo] of Object.entries(stepsData)) {
    if (stepInfo && typeof stepInfo === 'object') {
      stepsWithOutputs[stepSlug] = stepInfo;
    }
  }

  return stepsWithOutputs;
}
