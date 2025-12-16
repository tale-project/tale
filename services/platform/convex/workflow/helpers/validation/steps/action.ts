/**
 * Action Step Validator
 *
 * Validates action step configurations.
 */

import { validateActionParameters } from '../validate_action_parameters';
import type { ValidationResult } from '../types';

/**
 * Validate an action step configuration
 */
export function validateActionStep(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Action type is required
  if (!('type' in config)) {
    errors.push('Action type is required for action steps');
    return { valid: false, errors, warnings };
  }

  const actionType = config.type as string;

  // Get parameters - they can be in config.parameters or directly in config
  const parameters = 'parameters' in config ? config.parameters : { ...config };

  // Remove 'type' from parameters if it was copied from config
  if (typeof parameters === 'object' && parameters !== null && 'type' in parameters) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type: _type, ...rest } = parameters as Record<string, unknown>;
    const actionValidation = validateActionParameters(actionType, rest);
    errors.push(...actionValidation.errors);
    warnings.push(...actionValidation.warnings);
  } else {
    const actionValidation = validateActionParameters(actionType, parameters);
    errors.push(...actionValidation.errors);
    warnings.push(...actionValidation.warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

