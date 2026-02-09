/**
 * Step Configuration Validator
 *
 * This module validates step configurations to ensure they meet
 * the requirements for each step type.
 *
 * Step-type specific validation is delegated to validators in steps/.
 */

import { VALID_STEP_TYPES, isValidStepType, type StepType } from './constants';
import { validateStepByType } from './steps';
import {
  type StepDefinitionInput,
  type StepConfigValidationResult,
  isConfigObject,
} from './types';

export * from './constants';
export * from './types';

// =============================================================================
// STEP SLUG VALIDATION
// =============================================================================

/** Regex pattern for valid step slugs (snake_case with lowercase letters, digits, and underscores) */
const STEP_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * Validate a step slug format
 */
function validateStepSlug(stepSlug: string | undefined): string[] {
  const errors: string[] = [];

  if (!stepSlug) {
    errors.push('Step slug is required');
  } else if (!STEP_SLUG_PATTERN.test(stepSlug)) {
    errors.push(
      'Step slug must be snake_case and contain only lowercase letters, digits, and underscores (e.g., "first_step", "step_1")',
    );
  }

  return errors;
}

// =============================================================================
// MAIN VALIDATION FUNCTION
// =============================================================================

/**
 * Validate a single workflow step definition's basic fields and config.
 *
 * This helper is used both at authoring time (agent tool) and at runtime
 * to ensure that step definitions meet the same requirements everywhere.
 */
export function validateStepConfig(
  stepDef: StepDefinitionInput,
): StepConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate step slug
  errors.push(...validateStepSlug(stepDef.stepSlug));

  // 2. Validate step name
  if (!stepDef.name) {
    errors.push('Step name is required');
  }

  // 3. Validate step type
  if (!stepDef.stepType) {
    errors.push(
      `Step type is required. FIX: Add stepType = "start" | "llm" | "action" | "condition" | "loop"`,
    );
    return { valid: false, errors, warnings };
  }

  if (!isValidStepType(stepDef.stepType)) {
    errors.push(
      `Invalid step type "${stepDef.stepType}". FIX: Use one of: ${VALID_STEP_TYPES.join(', ')}. Note: "customer", "product", "approval" are ACTION TYPES (use stepType="action" with config.type="${stepDef.stepType}")`,
    );
    return { valid: false, errors, warnings };
  }

  // 4. Validate config object
  const config = stepDef.config;
  if (!isConfigObject(config)) {
    errors.push('Step config is required and must be an object');
    return { valid: false, errors, warnings };
  }

  // 5. Delegate to step-type specific validator
  const stepType = stepDef.stepType as StepType;
  const typeValidation = validateStepByType(stepType, config);
  errors.push(...typeValidation.errors);
  warnings.push(...typeValidation.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
