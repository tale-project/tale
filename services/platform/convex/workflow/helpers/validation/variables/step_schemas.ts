/**
 * Step Output Schemas
 *
 * Defines the known output structure for each step type.
 * All step outputs follow the pattern: { type: string, data: <result>, meta?: {...} }
 */

import type { OutputSchema, FieldSchema } from './types';

// =============================================================================
// CONDITION STEP OUTPUT SCHEMA
// =============================================================================

export const conditionOutputSchema: OutputSchema = {
  description: 'Condition evaluation result',
  fields: {
    passed: { type: 'boolean', description: 'Whether the condition passed' },
    description: { type: 'string', description: 'Human-readable condition description' },
    expression: { type: 'string', nullable: true, description: 'The evaluated expression' },
    message: { type: 'string', description: 'Result message' },
  },
};

// =============================================================================
// LOOP STEP OUTPUT SCHEMA
// =============================================================================

export const loopOutputSchema: OutputSchema = {
  description: 'Loop iteration state',
  fields: {
    state: {
      type: 'object',
      description: 'Loop state information',
      fields: {
        currentIndex: { type: 'number', description: 'Current iteration index' },
        totalItems: { type: 'number', description: 'Total number of items' },
        iterations: { type: 'number', description: 'Number of iterations completed' },
        batchesProcessed: { type: 'number', description: 'Number of batches processed' },
        isComplete: { type: 'boolean', description: 'Whether the loop is complete' },
      },
    },
    item: { type: 'any', description: 'Current item being processed' },
  },
};

// =============================================================================
// TRIGGER STEP OUTPUT SCHEMA
// =============================================================================

export const triggerOutputSchema: OutputSchema = {
  description: 'Trigger initialization result',
  fields: {
    triggerType: { type: 'string', description: 'Type of trigger (manual, scheduled, etc.)' },
    timestamp: { type: 'number', description: 'Trigger timestamp' },
  },
};

// =============================================================================
// LLM STEP OUTPUT SCHEMA
// =============================================================================

/**
 * LLM output schema - intentionally permissive because:
 * 1. When outputFormat: 'text', data = { text: string }
 * 2. When outputFormat: 'json', data = the parsed JSON object (any shape)
 *
 * Since we can't statically know the JSON schema, we mark this as 'dynamic'
 * to skip deep field validation for LLM outputs.
 */
export const llmOutputSchema: OutputSchema = {
  description: 'LLM execution result - dynamic structure based on outputFormat',
  // No fields defined = allow any field access (dynamic output)
};

// =============================================================================
// BASE ACTION OUTPUT WRAPPER
// =============================================================================

/**
 * All step outputs are wrapped in this structure
 */
export interface StepOutputWrapper {
  type: string; // 'action', 'llm', 'condition', 'loop', 'trigger'
  data: unknown;
  meta?: Record<string, unknown>;
}

/**
 * Get the base output schema for a step type
 */
export function getStepTypeOutputSchema(
  stepType: 'trigger' | 'llm' | 'action' | 'condition' | 'loop',
): OutputSchema {
  switch (stepType) {
    case 'condition':
      return conditionOutputSchema;
    case 'loop':
      return loopOutputSchema;
    case 'trigger':
      return triggerOutputSchema;
    case 'llm':
      return llmOutputSchema;
    case 'action':
      // Action schemas are dynamic based on action type and operation
      return { description: 'Action result - schema depends on action type and operation' };
    default:
      return { description: 'Unknown step type output' };
  }
}

/**
 * Validate that a path segment is valid for the output schema
 * Returns the schema for the resolved path, or null if invalid
 */
export function resolvePathInSchema(
  schema: OutputSchema | FieldSchema,
  pathSegments: string[],
): { resolved: FieldSchema | OutputSchema | null; remainingPath: string[] } {
  if (pathSegments.length === 0) {
    return { resolved: schema, remainingPath: [] };
  }

  const [current, ...rest] = pathSegments;

  // Handle array index access like [0]
  const arrayIndexMatch = current.match(/^\[(\d+)\]$/);
  if (arrayIndexMatch) {
    if ('isArray' in schema && schema.isArray && 'items' in schema && schema.items) {
      return resolvePathInSchema(schema.items, rest);
    }
    if ('type' in schema && schema.type === 'array' && 'items' in schema && schema.items) {
      return resolvePathInSchema(schema.items, rest);
    }
    // Can't index into non-array
    return { resolved: null, remainingPath: pathSegments };
  }

  // Handle object field access
  const fields = 'fields' in schema ? schema.fields : undefined;
  if (fields && current in fields) {
    return resolvePathInSchema(fields[current], rest);
  }

  // Allow any path access for 'any' type fields (dynamic output like loop items)
  if ('type' in schema && schema.type === 'any') {
    // Return a permissive schema for remaining path
    return { resolved: { type: 'any' }, remainingPath: [] };
  }

  // Field not found in schema
  return { resolved: null, remainingPath: pathSegments };
}
