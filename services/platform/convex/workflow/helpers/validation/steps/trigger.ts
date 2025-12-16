/**
 * Trigger Step Validator
 *
 * Validates trigger step configurations.
 */

import { VALID_TRIGGER_TYPES, type TriggerType, isValidTriggerType } from '../constants';
import type { ValidationResult } from '../types';

/**
 * Validate a trigger step configuration
 */
export function validateTriggerStep(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Trigger requires a type field
  if (!('type' in config)) {
    errors.push('Trigger step requires "type" field in config');
    return { valid: false, errors, warnings };
  }

  const triggerType = config.type as string;

  // Validate trigger type
  if (!isValidTriggerType(triggerType)) {
    errors.push(
      `Invalid trigger type "${triggerType}". Must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`
    );
    return { valid: false, errors, warnings };
  }

  // Validate type-specific trigger config
  const typeErrors = validateTriggerTypeConfig(triggerType, config);
  errors.push(...typeErrors);

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate trigger-type specific configuration
 */
function validateTriggerTypeConfig(
  triggerType: TriggerType,
  config: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  switch (triggerType) {
    case 'scheduled':
      errors.push(...validateScheduledTrigger(config));
      break;

    case 'event':
      errors.push(...validateEventTrigger(config));
      break;

    case 'manual':
      errors.push(...validateManualTrigger(config));
      break;

    case 'webhook':
      // Webhook triggers are flexible - minimal validation
      break;
  }

  return errors;
}

/**
 * Validate scheduled trigger configuration
 */
function validateScheduledTrigger(config: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!config.schedule) {
    errors.push('Scheduled trigger requires "schedule" field (cron expression)');
  } else if (typeof config.schedule !== 'string') {
    errors.push('Scheduled trigger "schedule" must be a string (cron expression)');
  } else {
    // Basic cron expression validation (5 or 6 parts)
    // Note: This only validates part count, not individual field ranges.
    const parts = (config.schedule as string).trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 6) {
      errors.push(
        `Invalid cron expression "${config.schedule}". Expected 5 or 6 space-separated parts (e.g., "0 * * * *" for every hour)`
      );
    }
  }

  return errors;
}

/**
 * Validate event trigger configuration
 */
function validateEventTrigger(config: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!config.eventType) {
    errors.push('Event trigger requires "eventType" field');
  } else if (typeof config.eventType !== 'string') {
    errors.push('Event trigger "eventType" must be a string');
  }

  return errors;
}

/**
 * Validate manual trigger configuration
 */
function validateManualTrigger(config: Record<string, unknown>): string[] {
  const errors: string[] = [];

  // Manual triggers have minimal requirements - just the type
  // Optionally can have inputs and data fields
  if (config.inputs !== undefined && !Array.isArray(config.inputs)) {
    errors.push('Manual trigger "inputs" must be an array if provided');
  }

  return errors;
}

