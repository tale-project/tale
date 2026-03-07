/**
 * End Step Validator
 *
 * Validates end step configurations.
 * End steps define the output mapping for a workflow.
 */

import type { ValidationResult } from '../types';

import { isRecord } from '../../../../../lib/utils/type-guards';

const SECRETS_PATTERN = /\{\{\s*secrets\./;

export function validateEndStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.outputMapping !== undefined) {
    if (!isRecord(config.outputMapping)) {
      errors.push('End step "outputMapping" must be an object if provided');
      return { valid: false, errors, warnings };
    }

    for (const [key, value] of Object.entries(config.outputMapping)) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(
          `End step outputMapping key "${key}" must be a non-empty string`,
        );
      } else if (SECRETS_PATTERN.test(value)) {
        warnings.push(
          `End step outputMapping key "${key}" references secrets — avoid exposing secrets in workflow output`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
