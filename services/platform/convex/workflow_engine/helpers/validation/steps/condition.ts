/**
 * Condition Step Validator
 *
 * Validates condition step configurations.
 */

import { validateJexlExpression } from '../../../../lib/variables/validate_template';
import type { ValidationResult } from '../types';

/**
 * Validate a condition step configuration
 */
export function validateConditionStep(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Expression is required
  if (!('expression' in config)) {
    errors.push('Expression is required for condition steps');
    return { valid: false, errors, warnings };
  }

  if (typeof config.expression !== 'string') {
    errors.push('Condition expression must be a string');
    return { valid: false, errors, warnings };
  }

  if (config.expression.trim() === '') {
    errors.push('Condition expression cannot be empty');
    return { valid: false, errors, warnings };
  }

  // Validate JEXL syntax
  const jexlValidation = validateJexlExpression(config.expression);
  if (!jexlValidation.valid) {
    errors.push(jexlValidation.error ?? 'Condition expression has invalid JEXL syntax');
  }

  return { valid: errors.length === 0, errors, warnings };
}

