/**
 * Validate NextSteps Port Names
 *
 * Ensures that nextSteps port names (keys) match the valid ports
 * for the given step type. This catches common AI agent mistakes
 * like using "next" or "default" instead of "success".
 */

import type { ValidationResult } from './types';

const VALID_PORTS: Record<string, readonly string[]> = {
  start: ['success'],
  trigger: ['success'],
  llm: ['success'],
  action: ['success'],
  condition: ['true', 'false'],
  loop: ['loop', 'done'],
  output: [],
};

/**
 * Validate that nextSteps port names are valid for the given step type.
 */
export function validateNextStepsPorts(
  stepType: string,
  nextSteps: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const validPorts = VALID_PORTS[stepType];
  if (!validPorts) {
    return { valid: true, errors, warnings };
  }

  const ports = Object.keys(nextSteps);

  if (stepType === 'output' && ports.length > 0) {
    errors.push(
      'Output steps must have empty nextSteps: {}. Output steps have no outgoing connections.',
    );
    return { valid: false, errors, warnings };
  }

  for (const port of ports) {
    if (!validPorts.includes(port)) {
      errors.push(
        `Invalid nextSteps port "${port}". Valid ports for ${stepType} steps: ${validPorts.join(', ')}`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
