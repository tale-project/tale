/**
 * Variable Reference Validation Module
 *
 * Provides utilities for parsing and validating variable references in workflow definitions.
 */

// Types
export type {
  ParsedVariableReference,
  VariableReferenceValidationResult,
  FieldType,
  FieldSchema,
  OutputSchema,
  OperationOutputSchemas,
  StepOutputStructure,
  StepSchemaContext,
  ActionOutputSchemaRegistry,
} from './types';

// Parsing utilities
export {
  parseVariableReferences,
  parseVariableReferencesFromString,
  extractStepReferences,
} from './parse_variable_references';

// Output schemas
export {
  conditionOutputSchema,
  loopOutputSchema,
  triggerOutputSchema,
  llmOutputSchema,
  getStepTypeOutputSchema,
  resolvePathInSchema,
} from './step_output_schemas';

export {
  actionOutputSchemaRegistry,
  getActionOutputSchema,
} from './action_output_schemas';

// Validation
export {
  validateWorkflowVariableReferences,
  type StepInfo,
  type ValidateVariableReferencesResult,
} from './validate_variable_references';

