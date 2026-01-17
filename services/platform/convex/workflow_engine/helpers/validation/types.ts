/**
 * Validation Types
 *
 * Shared type definitions for workflow validation.
 */

import type { StepType } from './constants';

// =============================================================================
// VALIDATION RESULT TYPES
// =============================================================================

/**
 * Base validation result interface.
 * All validators return this structure.
 */
export interface ValidationResult {
  /** Whether the validation passed (no errors) */
  valid: boolean;
  /** Error messages that indicate validation failure */
  errors: string[];
  /** Warning messages that don't fail validation but indicate potential issues */
  warnings: string[];
}

/**
 * Validation result for workflow definitions
 */
export type WorkflowValidationResult = ValidationResult;

/**
 * Validation result for step configurations
 */
export type StepConfigValidationResult = ValidationResult;

/**
 * Validation result for action parameters
 */
export type ActionParametersValidationResult = ValidationResult;

// =============================================================================
// STEP DEFINITION TYPES
// =============================================================================

/**
 * Input for step configuration validation.
 * Represents the minimal fields needed to validate a step.
 */
export interface StepDefinitionInput {
  /** Machine-readable step identifier (snake_case) */
  stepSlug?: string;
  /** Human-readable step name */
  name?: string;
  /** The type of step */
  stepType?: StepType | string;
  /** Step-specific configuration */
  config?: unknown;
}

/**
 * Strongly-typed step configuration for internal use.
 */
export interface StepConfig {
  stepSlug: string;
  name: string;
  stepType: StepType;
  config: Record<string, unknown>;
}

// =============================================================================
// WORKFLOW STRUCTURE TYPES
// =============================================================================

/**
 * Step configuration as stored in workflow definitions
 */
export interface WorkflowStepConfig {
  stepSlug: string;
  name: string;
  stepType: StepType;
  order: number;
  nextSteps?: Record<string, string>;
  config: Record<string, unknown>;
}

/**
 * Minimal workflow configuration for validation
 */
export interface WorkflowConfig {
  name?: string;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard to check if config is a valid object
 */
export function isConfigObject(config: unknown): config is Record<string, unknown> {
  return typeof config === 'object' && config !== null && !Array.isArray(config);
}

