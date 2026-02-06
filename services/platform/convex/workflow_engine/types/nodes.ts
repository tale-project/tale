/**
 * Node Type Definitions
 */

import type { Infer } from 'convex/values';
import { v } from 'convex/values';
import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../../lib/shared/schemas/utils/json-value';

// =============================================================================
// LLM NODE TYPES
// =============================================================================

/**
 * JSON Schema property definition for output schema validation.
 * Compatible with zod's JSONSchema type for use with z.fromJSONSchema().
 */
export interface JsonSchemaProperty {
  [k: string]: unknown;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  enum?: (string | number | boolean)[];
  nullable?: boolean;
}

/**
 * JSON Schema definition for LLM output validation.
 * Used to validate and ensure structured LLM outputs conform to expected shape.
 * Compatible with zod's JSONSchema type for use with z.fromJSONSchema().
 */
export interface JsonSchemaDefinition {
  [k: string]: unknown;
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  description?: string;
  additionalProperties?: boolean;
}

export interface LLMNodeConfig {
  // Basic node info
  name: string;
  description?: string;

  // Model configuration (provider-agnostic; any OpenAI-compatible model id)
  // Model is now controlled centrally via environment (OPENAI_MODEL) and cannot
  // be customized per step.
  // Temperature is automatically determined based on outputFormat:
  // - json → 0.2 (more deterministic for structured output)
  // - text → 0.5 (balanced creativity)
  model?: string;

  // Core prompts
  systemPrompt: string; // The system instructions/role definition
  userPrompt?: string; // The user task prompt (can also be in step config)

  // Tools the LLM can use
  tools?: string[]; // Array of Convex tool names

  // Advanced settings
  outputFormat?: 'text' | 'json';

  /**
   * Output schema for structured output validation.
   * When provided with outputFormat: 'json', the LLM output will be validated
   * against this schema using structured output generation.
   * Uses JSON Schema format which is converted to Zod at runtime.
   */
  outputSchema?: JsonSchemaDefinition;

  // Custom variables and context
  contextVariables?: Record<string, unknown>;
}

// =============================================================================
// CONDITION NODE TYPES
// =============================================================================

export interface ConditionNodeConfig {
  // JEXL expression
  expression?: string;
  description?: string;
  variables?: Record<string, unknown>;
}

// =============================================================================
// APPROVAL NODE TYPES
// =============================================================================

// =============================================================================
// ACTION NODE TYPES
// =============================================================================

export interface ActionNodeConfig {
  type: string; // action type key, resolved via registry
  parameters: Record<string, unknown>;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
  };
}

// =============================================================================
// LOOP NODE TYPES
// =============================================================================

export interface LoopNodeConfig {
  // Basic settings
  maxIterations?: number; // Max iterations to prevent infinite loops, default 1000

  // Data source (required for our strict mode)
  items?: unknown; // Mustache/JS expression or concrete array/object resolved at runtime

  // Loop variable settings
  itemVariable?: string; // Variable name for the current item, default 'item'
  indexVariable?: string; // Variable name for the current index, default 'index'

  // Error handling
  continueOnError?: boolean; // Whether to continue on error, default false

  // Description
  description?: string;
}

// JSON Schema definition validator for output schema
// Uses a relaxed approach - accepts any valid JSON object structure.
// Actual JSON Schema validation happens at runtime when the schema is used.
const jsonSchemaDefinitionValidator = v.object({
  type: v.literal('object'),
  properties: v.record(v.string(), v.any()),
  required: v.optional(v.array(v.string())),
  description: v.optional(v.string()),
  additionalProperties: v.optional(v.boolean()),
});

export const llmNodeConfigValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),

  // Allow arbitrary model ids so users can target any OpenAI-compatible provider
  // NOTE: Model is resolved from environment (OPENAI_MODEL) at runtime. This
  // field is optional and, if provided, is ignored by execution.
  // Temperature is auto-determined based on outputFormat (json→0.2, text→0.5).
  model: v.optional(v.string()),
  systemPrompt: v.string(),
  userPrompt: v.optional(v.string()),
  tools: v.optional(v.array(v.string())),
  outputFormat: v.optional(v.union(v.literal('text'), v.literal('json'))),
  // Output schema for structured output validation (JSON Schema format)
  outputSchema: v.optional(jsonSchemaDefinitionValidator),
  contextVariables: v.optional(
    v.record(
      v.string(),
      v.union(v.string(), v.number(), v.boolean(), v.null()),
    ),
  ),

  // ==========================================================================
  // DEPRECATED FIELDS (kept for backward compatibility during migration)
  // These fields are ignored at runtime. Run the migration to remove them:
  //   npx convex run workflows/internal_mutations:removeDeprecatedLLMFields
  // After migration completes, these fields can be removed from the validator.
  // ==========================================================================
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  maxSteps: v.optional(v.number()),
});

export const conditionNodeConfigValidator = v.object({
  // JEXL expression
  expression: v.optional(v.string()),
  description: v.optional(v.string()),
  variables: v.optional(
    v.record(
      v.string(),
      v.union(v.string(), v.number(), v.boolean(), v.null()),
    ),
  ),
});

export const actionNodeConfigValidator = v.object({
  type: v.string(),
  parameters: jsonRecordValidator,
  retryPolicy: v.optional(
    v.object({
      maxRetries: v.number(),
      backoffMs: v.number(),
    }),
  ),
});

export const loopNodeConfigValidator = v.object({
  maxIterations: v.optional(v.number()),
  items: v.optional(jsonValueValidator),
  itemVariable: v.optional(v.string()),
  indexVariable: v.optional(v.string()),
  continueOnError: v.optional(v.boolean()),
  description: v.optional(v.string()),
});

// =============================================================================
// START NODE TYPES (VALIDATOR)
// =============================================================================

/**
 * Start node config defines the input schema for a workflow.
 * Trigger sources (schedule, webhook, API) are configured separately
 * in the wfSchedules, wfWebhooks, and wfApiKeys tables.
 */
export const startNodeConfigValidator = v.object({
  inputSchema: v.optional(
    v.object({
      properties: v.record(
        v.string(),
        v.object({
          type: v.union(
            v.literal('string'),
            v.literal('number'),
            v.literal('integer'),
            v.literal('boolean'),
            v.literal('array'),
            v.literal('object'),
          ),
          description: v.optional(v.string()),
        }),
      ),
      required: v.optional(v.array(v.string())),
    }),
  ),
});

// =============================================================================
// TRIGGER NODE TYPES (VALIDATOR) — kept for backward compatibility with
// existing workflow data. New workflows should use 'start' step type.
// =============================================================================

export const triggerNodeConfigValidator = v.union(
  v.object({
    type: v.literal('manual'),
    inputs: v.optional(
      v.array(
        v.object({
          name: v.string(),
          type: v.union(
            v.literal('text'),
            v.literal('number'),
            v.literal('email'),
            v.literal('date'),
            v.literal('boolean'),
            v.literal('select'),
          ),
          description: v.optional(v.string()),
          placeholder: v.optional(v.string()),
          required: v.optional(v.boolean()),
        }),
      ),
    ),
    data: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
    context: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
  }),
  v.object({
    type: v.literal('scheduled'),
    schedule: v.string(),
    timezone: v.optional(v.string()),
    context: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
  }),
  v.object({
    type: v.literal('webhook'),
    webhookData: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
    headers: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
    context: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
  }),
  v.object({
    type: v.literal('event'),
    eventType: v.string(),
    eventData: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
    context: v.optional(
      v.record(
        v.string(),
        v.union(v.string(), v.number(), v.boolean(), v.null()),
      ),
    ),
  }),
);

// Support both shapes we handle at runtime: direct LLMNodeConfig or { llmNode: LLMNodeConfig }
export const llmStepConfigValidator = v.union(
  llmNodeConfigValidator,
  v.object({ llmNode: llmNodeConfigValidator }),
);

// Unified step-config validator used in schema/API
export const stepConfigValidator = v.union(
  startNodeConfigValidator,
  triggerNodeConfigValidator,
  llmStepConfigValidator,
  conditionNodeConfigValidator,
  actionNodeConfigValidator,
  loopNodeConfigValidator,
);

/** Inferred type from stepConfigValidator */
export type StepConfig = Infer<typeof stepConfigValidator>;
