/**
 * Types for Variable Reference Validation
 *
 * These types define the structure for validating workflow variable references
 * like {{steps.hydrate_recommendations.output.data}} against step output schemas.
 */

// Note: We use a generic type for validator since we only store schema info for documentation.
// Runtime validation is done separately by Convex functions.

// =============================================================================
// VARIABLE REFERENCE TYPES
// =============================================================================

/**
 * Parsed variable reference from a template string
 */
export interface ParsedVariableReference {
  /** The full original expression, e.g., "steps.hydrate_recommendations.output.data" */
  fullExpression: string;

  /** The type of reference */
  type: 'step' | 'variable' | 'system' | 'secret' | 'loop' | 'input';

  /** For step references, the step slug being referenced */
  stepSlug?: string;

  /** The path segments after the base reference */
  path: string[];

  /** The original template string, e.g., "{{steps.hydrate_recommendations.output.data}}" */
  originalTemplate: string;
}

/**
 * Result of validating a single variable reference
 */
export interface VariableReferenceValidationResult {
  valid: boolean;
  reference: ParsedVariableReference;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// OUTPUT SCHEMA TYPES
// =============================================================================

/**
 * Field type definitions for output schemas
 */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'id'
  | 'any'
  | 'null'
  | 'union';

/**
 * Schema definition for a single field
 */
export interface FieldSchema {
  type: FieldType;
  /** For 'id' type, the table name */
  table?: string;
  /** For 'array' type, the item schema */
  items?: FieldSchema;
  /** For 'object' type, nested field definitions */
  fields?: Record<string, FieldSchema>;
  /** For 'union' type, the possible schemas */
  variants?: FieldSchema[];
  /** Whether this field is optional */
  optional?: boolean;
  /** Whether this field can be null */
  nullable?: boolean;
  /** Human-readable description */
  description?: string;
}

/**
 * Output schema for an action operation
 */
export interface OutputSchema {
  /** Human-readable description */
  description?: string;
  /** Whether the output is an array at the top level */
  isArray?: boolean;
  /** Whether the output can be null */
  nullable?: boolean;
  /** Field definitions for object outputs */
  fields?: Record<string, FieldSchema>;
  /** For array outputs, the item schema */
  items?: FieldSchema;
}

/**
 * Map of operation name to output schema
 */
export type OperationOutputSchemas = Record<string, OutputSchema>;

// =============================================================================
// STEP OUTPUT SCHEMA TYPES
// =============================================================================

/**
 * Known output structure for each step type
 * All step outputs are wrapped in { type: string, data: <result> }
 */
export interface StepOutputStructure {
  /** The step type */
  stepType: 'trigger' | 'llm' | 'action' | 'condition' | 'loop';
  /** Schema for the 'data' field */
  dataSchema: OutputSchema;
  /** Additional fields available on the output (beyond type and data) */
  additionalFields?: Record<string, FieldSchema>;
}

/**
 * Context needed to resolve the output schema for a step
 */
export interface StepSchemaContext {
  stepSlug: string;
  stepType: 'trigger' | 'llm' | 'action' | 'condition' | 'loop';
  /** For action steps, the action type (e.g., 'product', 'approval') */
  actionType?: string;
  /** For action steps, the operation (e.g., 'hydrate_fields', 'create_approval') */
  operation?: string;
}

/**
 * Registry entry for action output schemas
 */
export interface ActionOutputSchemaRegistry {
  [actionType: string]: OperationOutputSchemas;
}
