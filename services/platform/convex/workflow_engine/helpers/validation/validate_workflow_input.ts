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

const TYPE_CHECKERS: Record<string, (value: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && !Number.isNaN(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => isRecord(v),
};

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
        `Parameter '${field}' expected type '${schema.type}', got '${Array.isArray(value) ? 'array' : typeof value}'`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
