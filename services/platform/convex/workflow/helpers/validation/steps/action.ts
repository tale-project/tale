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
  // Normalize to a single variable with 'type' removed for cleaner validation
  let parameters: unknown;
  if ('parameters' in config) {
    parameters = config.parameters;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type: _type, ...rest } = config;
    parameters = rest;
  }

  const actionValidation = validateActionParameters(actionType, parameters);
  errors.push(...actionValidation.errors);
  warnings.push(...actionValidation.warnings);

  return { valid: errors.length === 0, errors, warnings };
}

