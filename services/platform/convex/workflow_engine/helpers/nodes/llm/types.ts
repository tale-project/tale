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
 * Normalized configuration for LLM node execution.
 *
 * Note: The following fields are intentionally not exposed in workflow definitions:
 * - maxTokens: uses model's default value
 * - maxSteps: defaults to 40 when tools are configured (see createAgentConfig)
 * - temperature: auto-determined based on outputFormat (json→0.2, text→0.5)
 */
export interface NormalizedConfig {
  name: string;

  systemPrompt: string;
  userPrompt: string;
  model: string;
  outputFormat?: 'text' | 'json';
  /**
   * Output schema for structured output validation.
   * When provided with outputFormat: 'json', the agent uses generateObject
   * to produce structured output that conforms to this schema.
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
