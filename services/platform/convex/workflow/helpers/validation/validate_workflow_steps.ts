/**
 * Validate Workflow Steps References
 *
 * Validates that all nextSteps references point to valid steps in the workflow.
 * This is a structural validation that ensures the workflow graph is valid.
 */

/**
 * Validate that all nextSteps references point to valid steps
 *
 * @param steps - Array of step definitions
 * @throws Error if any nextSteps reference is invalid
 */
export function validateWorkflowSteps(
  steps: Array<{
    stepSlug: string;
    name: string;
    nextSteps?: Record<string, string>;
  }>
): void {
  // Build a set of valid step slugs for O(1) lookup
  const validStepSlugs = new Set(steps.map((step) => step.stepSlug));

  // Validate each step's nextSteps references
  for (const step of steps) {
    if (!step.nextSteps) {
      continue;
    }

    const nextSteps = step.nextSteps as Record<string, string>;

    for (const [port, nextStepSlug] of Object.entries(nextSteps)) {
      // Skip special 'noop' keyword
      if (nextStepSlug === 'noop') {
        continue;
      }

      // Check if the referenced step exists
      if (!validStepSlugs.has(nextStepSlug)) {
        const availableSteps = Array.from(validStepSlugs).join(', ');
        throw new Error(
          `Invalid workflow configuration: Step '${step.stepSlug}' (${step.name}) references non-existent step '${nextStepSlug}' in nextSteps port '${port}'. Available steps: ${availableSteps}`
        );
      }
    }
  }
}

