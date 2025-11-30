/**
 * Build steps config map from steps array
 *
 * Converts an array of steps into a map of stepSlug -> config
 */

/**
 * Build steps config map
 *
 * @param steps - Array of steps with stepSlug and config
 * @returns Map of stepSlug to config
 */
export function buildStepsConfigMap(
  steps: Array<{ stepSlug: string; config: unknown }>,
): Record<string, unknown> {
  const stepsConfigMap: Record<string, unknown> = {};
  for (const step of steps) {
    stepsConfigMap[step.stepSlug] = step.config;
  }
  return stepsConfigMap;
}

