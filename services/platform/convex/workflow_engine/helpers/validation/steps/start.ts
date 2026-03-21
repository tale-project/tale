/**
 * Start Step Validator
 *
 * Validates start step configurations.
 * Start steps define the input schema for a workflow.
 * Trigger sources (schedule, webhook, API) are configured separately.
 */

import type { ValidationResult } from '../types';

import { isRecord } from '../../../../../lib/utils/type-guards';

const VALID_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
]);

function hasValidType(prop: Record<string, unknown>): boolean {
  return (
    !!prop.type &&
    VALID_SCHEMA_TYPES.has(typeof prop.type === 'string' ? prop.type : '')
  );
}

function validateNestedProperties(
  properties: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value)) {
      errors.push(`${path}.${key} must be an object`);
      continue;
    }
    if (!hasValidType(value)) {
      errors.push(
        `${path}.${key} has invalid type. Must be one of: ${[...VALID_SCHEMA_TYPES].join(', ')}`,
      );
    }
  }
}

function validatePropertySchema(
  key: string,
  prop: Record<string, unknown>,
  errors: string[],
): void {
  if (!hasValidType(prop)) {
    errors.push(
      `Start step input property "${key}" has invalid type. Must be one of: ${[...VALID_SCHEMA_TYPES].join(', ')}`,
    );
  }

  // Validate items (for array types)
  if (prop.items !== undefined) {
    if (prop.type !== 'array') {
      errors.push(
        `Start step input property "${key}" has "items" but type is not "array"`,
      );
    } else if (!isRecord(prop.items)) {
      errors.push(`Start step input property "${key}.items" must be an object`);
    } else {
      const items = prop.items;
      if (!hasValidType(items)) {
        errors.push(
          `Start step input property "${key}.items" has invalid type. Must be one of: ${[...VALID_SCHEMA_TYPES].join(', ')}`,
        );
      }
      if (items.properties !== undefined) {
        if (!isRecord(items.properties)) {
          errors.push(
            `Start step input property "${key}.items.properties" must be an object`,
          );
        } else {
          validateNestedProperties(
            items.properties,
            `"${key}.items.properties"`,
            errors,
          );
        }
      }
    }
  }

  // Validate properties (for object types)
  if (prop.properties !== undefined) {
    if (prop.type !== 'object') {
      errors.push(
        `Start step input property "${key}" has "properties" but type is not "object"`,
      );
    } else if (!isRecord(prop.properties)) {
      errors.push(
        `Start step input property "${key}.properties" must be an object`,
      );
    } else {
      validateNestedProperties(prop.properties, `"${key}.properties"`, errors);
    }
  }
}

export function validateStartStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.inputSchema !== undefined) {
    if (!isRecord(config.inputSchema)) {
      errors.push('Start step "inputSchema" must be an object if provided');
      return { valid: false, errors, warnings };
    }

    const schema = config.inputSchema;

    if (schema.properties !== undefined) {
      if (!isRecord(schema.properties)) {
        errors.push(
          'Start step "inputSchema.properties" must be an object if provided',
        );
      } else {
        for (const [key, value] of Object.entries(schema.properties)) {
          if (!isRecord(value)) {
            errors.push(`Start step input property "${key}" must be an object`);
            continue;
          }
          validatePropertySchema(key, value, errors);
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
