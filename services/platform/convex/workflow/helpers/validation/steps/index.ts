/**
 * Step Validators Index
 *
 * Provides validation functions for each step type.
 */

import type { StepType } from '../constants';
import type { ValidationResult } from '../types';

// Re-export individual validators
export { validateTriggerStep } from './trigger';
export { validateLlmStep } from './llm';
export { validateConditionStep } from './condition';
export { validateActionStep } from './action';
export { validateLoopStep } from './loop';

// Import for local use in stepValidators map
import { validateTriggerStep } from './trigger';
import { validateLlmStep } from './llm';
import { validateConditionStep } from './condition';
import { validateActionStep } from './action';
import { validateLoopStep } from './loop';

/**
 * Map of step type to validator function
 */
const stepValidators: Record<
  StepType,
  (config: Record<string, unknown>) => ValidationResult
> = {
  trigger: validateTriggerStep,
  llm: validateLlmStep,
  condition: validateConditionStep,
  action: validateActionStep,
  loop: validateLoopStep,
};

/**
 * Get the validator function for a step type
 */
export function getStepValidator(
  stepType: StepType
): (config: Record<string, unknown>) => ValidationResult {
  return stepValidators[stepType];
}

/**
 * Validate a step configuration based on its type
 */
export function validateStepByType(
  stepType: StepType,
  config: Record<string, unknown>
): ValidationResult {
  const validator = stepValidators[stepType];
  return validator(config);
}

