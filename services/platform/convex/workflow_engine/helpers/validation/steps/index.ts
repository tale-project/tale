/**
 * Step Validators Index
 */

import type { StepType } from '../constants';
import type { ValidationResult } from '../types';

export * from './start';
export * from './llm';
export * from './condition';
export * from './action';
export * from './loop';

import { validateStartStep } from './start';
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
  start: validateStartStep,
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
