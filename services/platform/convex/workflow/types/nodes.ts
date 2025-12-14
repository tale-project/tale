/**
 * Node Type Definitions
 */

import { v } from 'convex/values';

// =============================================================================
// LLM NODE TYPES
// =============================================================================

export interface LLMNodeConfig {
  // Basic node info
  name: string;
  description?: string;

  // Model configuration (provider-agnostic; any OpenAI-compatible model id)
  // Model is now controlled centrally via environment (OPENAI_MODEL) and cannot
  // be customized per step.
  model?: string;
  temperature?: number; // 0.0 - 1.0
  maxTokens?: number;
  maxSteps?: number; // Maximum number of tool calling iterations (default: 10)

  // Core prompts
  systemPrompt: string; // The system instructions/role definition
  userPrompt?: string; // The user task prompt (can also be in step config)

  // Tools the LLM can use
  tools?: string[]; // Array of Convex tool names
  mcpServerIds?: string[]; // IDs of MCP servers to use (resolved from central catalog)

  // Advanced settings
  outputFormat?: 'text' | 'json';

  // Custom variables and context
  contextVariables?: Record<string, unknown>;
}

// MCP Server Configuration
export interface MCPServerConfig {
  serverId: string;
  name: string;
  url: string;
  sessionId?: string;
  authConfig?: {
    headers?: Record<string, string>;
    credentials?: Record<string, string>;
  };
  enabled: boolean;
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

export const llmNodeConfigValidator = v.object({
  name: v.string(),
  description: v.optional(v.string()),

  // Allow arbitrary model ids so users can target any OpenAI-compatible provider
  // NOTE: Model is resolved from environment (OPENAI_MODEL) at runtime. This
  // field is optional and, if provided, is ignored by execution.
  model: v.optional(v.string()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  maxSteps: v.optional(v.number()),
  systemPrompt: v.string(),
  userPrompt: v.optional(v.string()),
  tools: v.optional(v.array(v.string())),
  mcpServerIds: v.optional(v.array(v.string())),
  outputFormat: v.optional(v.union(v.literal('text'), v.literal('json'))),
  contextVariables: v.optional(
    v.record(
      v.string(),
      v.union(v.string(), v.number(), v.boolean(), v.null()),
    ),
  ),
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
  parameters: v.any(), // Allow any parameters structure for flexibility with MongoDB operators
  retryPolicy: v.optional(
    v.object({
      maxRetries: v.number(),
      backoffMs: v.number(),
    }),
  ),
});

export const loopNodeConfigValidator = v.object({
  maxIterations: v.optional(v.number()),
  items: v.optional(v.any()),
  itemVariable: v.optional(v.string()),
  indexVariable: v.optional(v.string()),
  continueOnError: v.optional(v.boolean()),
  description: v.optional(v.string()),
});

// =============================================================================
// TRIGGER NODE TYPES (VALIDATOR)
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
  triggerNodeConfigValidator,
  llmStepConfigValidator,
  conditionNodeConfigValidator,
  actionNodeConfigValidator,
  loopNodeConfigValidator,
);
