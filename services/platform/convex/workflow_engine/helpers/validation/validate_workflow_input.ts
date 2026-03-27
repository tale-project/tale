/**
 * Workflow Input Validation
 *
 * Validates workflow input parameters against the start node's inputSchema.
 * Used by the run_workflow agent tool to reject invalid parameters before
 * creating an approval card.
 */

import type { Infer } from 'convex/values';

import type { startNodeConfigValidator } from '../../types/nodes';
import type { ValidationResult } from './types';

import { isRecord } from '../../../../lib/utils/type-guards';

export type WorkflowInputSchema = NonNullable<
  Infer<typeof startNodeConfigValidator>['inputSchema']
>;

type PropertySchema = WorkflowInputSchema['properties'][string];

const TYPE_CHECKERS: Record<string, (value: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && !Number.isNaN(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => isRecord(v),
};

function getTypeName(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value;
}

function validateNestedObject(
  value: Record<string, unknown>,
  properties: Record<string, { type: string }>,
  required: string[] | undefined,
  path: string,
  errors: string[],
): void {
  if (required) {
    for (const field of required) {
      if (value[field] === undefined || value[field] === null) {
        errors.push(`Missing required field: '${path}.${field}'`);
      }
    }
  }
  for (const [field, fieldSchema] of Object.entries(properties)) {
    const fieldValue = value[field];
    if (fieldValue === undefined || fieldValue === null) continue;
    const checker = TYPE_CHECKERS[fieldSchema.type];
    if (checker && !checker(fieldValue)) {
      errors.push(
        `Field '${path}.${field}' expected type '${fieldSchema.type}', got '${getTypeName(fieldValue)}'`,
      );
    }
  }
}

function validateArrayItems(
  value: unknown[],
  schema: PropertySchema,
  field: string,
  errors: string[],
): void {
  const items = schema.items;
  if (!items) return;

  const itemChecker = TYPE_CHECKERS[items.type];
  if (!itemChecker) return;

  for (let i = 0; i < value.length; i++) {
    const element = value[i];
    if (!itemChecker(element)) {
      errors.push(
        `Parameter '${field}[${i}]' expected type '${items.type}', got '${getTypeName(element)}'`,
      );
      continue;
    }
    // Validate object element properties if defined
    if (items.properties && isRecord(element)) {
      validateNestedObject(
        element,
        items.properties,
        items.required,
        `${field}[${i}]`,
        errors,
      );
    }
  }
}

function validateObjectProperties(
  value: Record<string, unknown>,
  schema: PropertySchema,
  field: string,
  errors: string[],
): void {
  if (!schema.properties) return;
  validateNestedObject(
    value,
    schema.properties,
    schema.required,
    field,
    errors,
  );
}

export function validateWorkflowInput(
  input: Record<string, unknown> | undefined,
  inputSchema: WorkflowInputSchema | undefined,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!inputSchema) {
    return { valid: true, errors, warnings };
  }

  const effectiveInput = input ?? {};

  // Validate required fields
  if (inputSchema.required) {
    for (const field of inputSchema.required) {
      const value = effectiveInput[field];
      if (value === undefined || value === null) {
        errors.push(`Missing required parameter: '${field}'`);
      }
    }
  }

  // Validate types for provided fields that are declared in properties
  for (const [field, schema] of Object.entries(inputSchema.properties)) {
    const value = effectiveInput[field];
    if (value === undefined || value === null) continue;

    const checker = TYPE_CHECKERS[schema.type];
    if (checker && !checker(value)) {
      errors.push(
        `Parameter '${field}' expected type '${schema.type}', got '${getTypeName(value)}'`,
      );
      continue;
    }

    // Validate array items
    if (schema.type === 'array' && Array.isArray(value)) {
      validateArrayItems(value, schema, field, errors);
    }

    // Validate object properties
    if (schema.type === 'object' && isRecord(value)) {
      validateObjectProperties(value, schema, field, errors);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
