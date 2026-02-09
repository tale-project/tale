/**
 * Start Step Validator
 *
 * Validates start step configurations.
 * Start steps define the input schema for a workflow.
 * Trigger sources (schedule, webhook, API) are configured separately.
 */

import type { ValidationResult } from '../types';

const VALID_SCHEMA_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
] as const;

export function validateStartStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.inputSchema !== undefined) {
    if (typeof config.inputSchema !== 'object' || config.inputSchema === null) {
      errors.push('Start step "inputSchema" must be an object if provided');
      return { valid: false, errors, warnings };
    }

    const schema = config.inputSchema as Record<string, unknown>;

    if (schema.properties !== undefined) {
      if (typeof schema.properties !== 'object' || schema.properties === null) {
        errors.push(
          'Start step "inputSchema.properties" must be an object if provided',
        );
      } else {
        const properties = schema.properties as Record<string, unknown>;
        for (const [key, value] of Object.entries(properties)) {
          if (typeof value !== 'object' || value === null) {
            errors.push(`Start step input property "${key}" must be an object`);
            continue;
          }
          const prop = value as Record<string, unknown>;
          if (
            !prop.type ||
            !VALID_SCHEMA_TYPES.includes(
              prop.type as (typeof VALID_SCHEMA_TYPES)[number],
            )
          ) {
            errors.push(
              `Start step input property "${key}" has invalid type. Must be one of: ${VALID_SCHEMA_TYPES.join(', ')}`,
            );
          }
        }
      }
    }

    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required)) {
        errors.push(
          'Start step "inputSchema.required" must be an array if provided',
        );
      } else if (
        !(schema.required as unknown[]).every(
          (item) => typeof item === 'string',
        )
      ) {
        errors.push(
          'Start step "inputSchema.required" must be an array of strings',
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
