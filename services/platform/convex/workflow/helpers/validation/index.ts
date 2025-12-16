/**
 * Workflow Validation Module
 *
 * MAIN ENTRY POINT: Import from this file for all validation needs.
 *
 * ## Primary API (most common usage)
 *
 * ```ts
 * import { validateWorkflowDefinition } from './validation';
 *
 * const result = validateWorkflowDefinition(workflowConfig, stepsConfig);
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 *
 * ## What gets validated
 *
 * 1. Workflow structure (name, steps array)
 * 2. Step structure (stepSlug, name, stepType, config, order, nextSteps)
 * 3. Step-type specific requirements (trigger, llm, action, condition, loop)
 * 4. Action parameter validation against registered actions
 * 5. Variable reference validation (step existence, execution order, path structure)
 */

// =============================================================================
// PRIMARY API - Use these for most validation needs
// =============================================================================

/**
 * Validate a complete workflow definition (workflow config + all steps).
 * This is the main entry point for workflow validation.
 */
export { validateWorkflowDefinition } from './validate_workflow_definition';

/** Result type for validateWorkflowDefinition */
export type { WorkflowValidationResult } from './types';

// =============================================================================
// SECONDARY API - For specific validation scenarios
// =============================================================================

/** Validate a single step configuration (used by agent tools) */
export { validateStepConfig } from './validate_step_config';

/** Validate that nextSteps references point to valid steps */
export { validateWorkflowSteps } from './validate_workflow_steps';

/** Validate action parameters against the action registry */
export { validateActionParameters } from './validate_action_parameters';

// =============================================================================
// CONSTANTS & TYPE GUARDS
// =============================================================================

export {
  VALID_STEP_TYPES,
  VALID_TRIGGER_TYPES,
  isValidStepType,
  isValidTriggerType,
  type StepType,
  type TriggerType,
} from './constants';

// =============================================================================
// TYPES
// =============================================================================

export type {
  ValidationResult,
  StepConfigValidationResult,
  ActionParametersValidationResult,
  StepDefinitionInput,
  StepConfig,
  WorkflowStepConfig,
  WorkflowConfig,
} from './types';

export { isConfigObject } from './types';

// =============================================================================
// ADVANCED API - Step-type specific validators (internal use)
// =============================================================================

export {
  validateTriggerStep,
  validateLlmStep,
  validateConditionStep,
  validateActionStep,
  validateLoopStep,
  validateStepByType,
  getStepValidator,
} from './steps';

// =============================================================================
// ADVANCED API - Variable reference validation utilities
// =============================================================================

export {
  // Types
  type ParsedVariableReference,
  type VariableReferenceValidationResult,
  type FieldType,
  type FieldSchema,
  type OutputSchema,
  type OperationOutputSchemas,
  type StepOutputStructure,
  type StepSchemaContext,
  type ActionOutputSchemaRegistry,
  type StepInfo,
  type ValidateVariableReferencesResult,
  // Parsing utilities
  parseVariableReferences,
  parseVariableReferencesFromString,
  extractStepReferences,
  parseJexlExpression,
  extractStepReferencesFromCondition,
  // Output schemas
  conditionOutputSchema,
  loopOutputSchema,
  triggerOutputSchema,
  llmOutputSchema,
  getStepTypeOutputSchema,
  resolvePathInSchema,
  actionOutputSchemaRegistry,
  getActionOutputSchema,
  // Validation
  validateWorkflowVariableReferences,
} from './variables';

