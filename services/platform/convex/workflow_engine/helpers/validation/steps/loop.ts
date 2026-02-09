/**
 * Loop Step Validator
 *
 * Validates loop step configurations.
 */

import type { ValidationResult } from '../types';

/**
 * Validate a loop step configuration
 */
export function validateLoopStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { maxIterations, items } = config as {
    maxIterations?: unknown;
    items?: unknown;
  };

  // Validate maxIterations if provided
  if (maxIterations !== undefined) {
    if (typeof maxIterations !== 'number' || maxIterations <= 0) {
      errors.push('Max iterations must be a positive number for loop steps');
    }
  }

  // Warn if no items source is defined
  if (items === undefined) {
    warnings.push(
      'Loop step has no "items" defined - loop may not iterate over anything',
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
