/**
 * Output Step Validator
 *
 * Validates output step configurations.
 * Output steps define the output mapping for a workflow.
 */

import type { ValidationResult } from '../types';

import { isRecord } from '../../../../../lib/utils/type-guards';

const SECRETS_PATTERN = /\{\{\s*secrets\./;

export function validateOutputStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Backward compat: accept both "mapping" (new) and "outputMapping" (legacy)
  if ('outputMapping' in config && !('mapping' in config)) {
    warnings.push(
      'Output step field "outputMapping" is deprecated. Use "mapping" instead.',
    );
  }
  const mapping =
    'mapping' in config
      ? config.mapping
      : 'outputMapping' in config
        ? config.outputMapping
        : undefined;

  if (mapping !== undefined) {
    if (!isRecord(mapping)) {
      errors.push('Output step "mapping" must be an object if provided');
      return { valid: false, errors, warnings };
    }

    for (const [key, value] of Object.entries(mapping)) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push(
          `Output step mapping key "${key}" must be a non-empty string`,
        );
      } else if (SECRETS_PATTERN.test(value)) {
        warnings.push(
          `Output step mapping key "${key}" references secrets — avoid exposing secrets in workflow output`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
