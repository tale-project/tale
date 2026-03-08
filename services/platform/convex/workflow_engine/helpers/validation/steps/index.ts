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
export * from './output';

import { validateActionStep } from './action';
import { validateConditionStep } from './condition';
import { validateLlmStep } from './llm';
import { validateLoopStep } from './loop';
import { validateOutputStep } from './output';
import { validateStartStep } from './start';

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
  output: validateOutputStep,
};

/**
 * Get the validator function for a step type
 */
export function getStepValidator(
  stepType: StepType,
): (config: Record<string, unknown>) => ValidationResult {
  return stepValidators[stepType];
}

/**
 * Validate a step configuration based on its type
 */
export function validateStepByType(
  stepType: StepType,
  config: Record<string, unknown>,
): ValidationResult {
  const validator = stepValidators[stepType];
  return validator(config);
}
