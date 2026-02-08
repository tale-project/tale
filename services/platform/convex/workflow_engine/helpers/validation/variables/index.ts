/**
 * Variable Reference Validation Module
 *
 * Provides utilities for parsing and validating variable references in workflow definitions.
 */

// Types
export type {
  StepType,
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
  parseJexlExpression,
  extractStepReferencesFromCondition,
} from './parse';

// Output schemas
export {
  conditionOutputSchema,
  loopOutputSchema,
  startOutputSchema,
  llmOutputSchema,
  getStepTypeOutputSchema,
  resolvePathInSchema,
} from './step_schemas';

export {
  actionOutputSchemaRegistry,
  getActionOutputSchema,
} from './action_schemas';

// Validation
export {
  validateWorkflowVariableReferences,
  type StepInfo,
  type ValidateVariableReferencesResult,
} from './validate';

