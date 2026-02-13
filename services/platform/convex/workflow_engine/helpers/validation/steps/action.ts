/**
 * Action Step Validator
 *
 * Validates action step configurations.
 */

import type { ValidationResult } from '../types';

import { getString } from '../../../../../lib/utils/type-guards';
import { validateActionParameters } from '../validate_action_parameters';

/**
 * Validate an action step configuration
 */
export function validateActionStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Action type is required
  if (!('type' in config)) {
    errors.push(
      'Action step requires "type" field in config. FIX: Add config.type = "customer" | "product" | "approval" | "workflow_processing_records" | "set_variables" | "integration" | "conversation"',
    );
    return { valid: false, errors, warnings };
  }

  const actionType = getString(config, 'type');
  if (!actionType) {
    errors.push('Action step "type" field must be a string');
    return { valid: false, errors, warnings };
  }

  // Warn if nextSteps is misplaced inside config (should be at the step level)
  if ('nextSteps' in config) {
    warnings.push(
      'Found "nextSteps" inside config. FIX: Move nextSteps to the step level (updates.nextSteps), not inside updates.config',
    );
  }

  // Get parameters - they can be in config.parameters or directly in config
  // Normalize to a single variable with 'type' removed for cleaner validation
  let parameters: unknown;
  if ('parameters' in config) {
    parameters = config.parameters;
  } else {
    // Strip known non-parameter fields that the AI agent commonly misplaces
    const { type: _type, nextSteps: _nextSteps, ...rest } = config;
    parameters = rest;
  }

  const actionValidation = validateActionParameters(actionType, parameters);
  errors.push(...actionValidation.errors);
  warnings.push(...actionValidation.warnings);

  return { valid: errors.length === 0, errors, warnings };
}
