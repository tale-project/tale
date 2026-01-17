/**
 * LLM Node Types
 *
 * Centralized type definitions for LLM node functionality.
 */

import type { JsonSchemaDefinition } from '../../../types/nodes';

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Normalized configuration for LLM node execution
 */
export interface NormalizedConfig {
  name: string;

  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  maxSteps?: number;
  outputFormat?: 'text' | 'json';
  /**
   * Output schema for structured output validation.
   * When provided, the agent uses a json_output tool to capture structured
   * output that conforms to this schema.
   */
  outputSchema?: JsonSchemaDefinition;
  tools?: string[];
  contextVariables?: Record<string, unknown>;
}

/**
 * Processed prompts with variable substitution
 */
export interface ProcessedPrompts {
  systemPrompt: string;
  userPrompt: string;
  availableSteps: string[];
  missingVariables: string[];
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Tool diagnostics information
 */
export interface ToolDiagnostics {
  lastToolName: string | null;
  lastToolInputText: string | null;
  lastToolResultText: string | null;
}

/**
 * Processed agent result with steps and diagnostics
 */
export interface ProcessedAgentResult {
  agentSteps: unknown;
  toolDiagnostics: ToolDiagnostics;
}

/**
 * Final LLM execution result
 */
export interface LLMExecutionResult {
  outputText: string;
  finalOutput: unknown;
  agentSteps: unknown;
  toolDiagnostics: ToolDiagnostics;
  threadId: string; // Thread ID used for this execution
}
