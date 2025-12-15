/**
 * Validate Variable References
 *
 * Validates that variable references in workflow step configurations:
 * 1. Reference steps that exist in the workflow
 * 2. Reference steps in correct execution order (can only reference earlier steps)
 * 3. Access valid paths in the step output structure
 */

import type {
  ParsedVariableReference,
  VariableReferenceValidationResult,
  StepSchemaContext,
  OutputSchema,
  FieldSchema,
} from './types';
import { extractStepReferences } from './parse_variable_references';
import { getStepTypeOutputSchema } from './step_output_schemas';
import { getActionOutputSchema } from './action_output_schemas';

// =============================================================================
// TYPES
// =============================================================================

export interface StepInfo {
  stepSlug: string;
  stepType: 'trigger' | 'llm' | 'action' | 'condition' | 'loop';
  order: number;
  config: Record<string, unknown>;
}

export interface ValidateVariableReferencesResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  references: VariableReferenceValidationResult[];
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Get the schema context for a step
 */
function getStepSchemaContext(step: StepInfo): StepSchemaContext {
  const context: StepSchemaContext = {
    stepSlug: step.stepSlug,
    stepType: step.stepType,
  };

  if (step.stepType === 'action' && step.config) {
    context.actionType = step.config.type as string | undefined;
    const params = step.config.parameters as Record<string, unknown> | undefined;
    context.operation = params?.operation as string | undefined;
    // Some actions have operation directly in config
    if (!context.operation && step.config.operation) {
      context.operation = step.config.operation as string;
    }
  }

  return context;
}

/**
 * Get the output schema for a step
 */
function getOutputSchemaForStep(step: StepInfo): OutputSchema | null {
  if (step.stepType === 'action') {
    const actionType = step.config?.type as string | undefined;
    const params = step.config?.parameters as Record<string, unknown> | undefined;
    const operation = (params?.operation ?? step.config?.operation) as string | undefined;

    if (actionType) {
      return getActionOutputSchema(actionType, operation);
    }
    return null;
  }

  return getStepTypeOutputSchema(step.stepType);
}

/**
 * Check if a path segment contains a Jinja2 filter (e.g., |length, |string)
 */
function containsJinjaFilter(pathSegment: string): boolean {
  return pathSegment.includes('|');
}

/**
 * Strip Jinja2 filters from a path segment to get the base field name
 */
function stripJinjaFilters(pathSegment: string): string {
  const pipeIndex = pathSegment.indexOf('|');
  return pipeIndex === -1 ? pathSegment : pathSegment.substring(0, pipeIndex);
}

/**
 * Validate the path structure of a step reference
 */
function validateStepReferencePath(
  ref: ParsedVariableReference,
  referencedStep: StepInfo,
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Skip validation for complex expressions (ternary, comparisons, etc.)
  if (ref.path.length > 0 && ref.path[0] === '__complex_expression__') {
    // Complex expressions can't be statically validated for field access
    // The step reference itself was already validated (step exists, order correct)
    return { valid: true, errors, warnings };
  }

  // Step references should start with 'output'
  if (ref.path.length === 0) {
    warnings.push(
      `Reference "${ref.originalTemplate}" accesses step directly without path. ` +
        `Did you mean "{{steps.${ref.stepSlug}.output}}"?`,
    );
    return { valid: true, errors, warnings };
  }

  const [first, ...restPath] = ref.path;

  if (first !== 'output') {
    errors.push(
      `Reference "${ref.originalTemplate}" uses invalid path. ` +
        `Step references should use "steps.${ref.stepSlug}.output..." pattern.`,
    );
    return { valid: false, errors, warnings };
  }

  // Validate the path after 'output'
  if (restPath.length === 0) {
    // Just accessing .output is valid
    return { valid: true, errors, warnings };
  }

  const schema = getOutputSchemaForStep(referencedStep);

  // If we have a schema, validate against it
  if (schema) {
    const [dataOrMeta, ...fieldPath] = restPath;
    // Strip Jinja filters from the first segment if present
    const cleanDataOrMeta = stripJinjaFilters(dataOrMeta);

    if (cleanDataOrMeta === 'data') {
      // Check if the path contains Jinja filters
      const hasJinjaFilters = restPath.some(containsJinjaFilter);
      if (hasJinjaFilters) {
        // Valid Jinja filter usage - don't validate further but note it
        // This handles patterns like {{steps.x.output.data|length}}
        return { valid: true, errors, warnings };
      }

      // Accessing .output.data is the standard pattern
      if (fieldPath.length > 0) {
        if (schema.isArray) {
          // Check if trying to access a property on an array result
          const firstField = fieldPath[0];
          const isArrayIndex = /^\[\d+\]$/.test(firstField) || /^\d+$/.test(firstField);

          if (!isArrayIndex && firstField !== 'length') {
            warnings.push(
              `Reference "${ref.originalTemplate}" accesses ".${firstField}" on an array result. ` +
                `The "${referencedStep.config?.type}.${getStepSchemaContext(referencedStep).operation}" ` +
                `action returns an array. Use "[index]" to access specific items or ".length" for count.`,
            );
          }
        } else if (schema.fields) {
          // Validate field path against schema
          const validationResult = validateFieldPath(fieldPath, schema, ref, referencedStep);
          errors.push(...validationResult.errors);
          warnings.push(...validationResult.warnings);
          if (!validationResult.valid) {
            return { valid: false, errors, warnings };
          }
        }
      }
    } else if (cleanDataOrMeta === 'meta') {
      // Accessing .output.meta is valid but less common
      warnings.push(
        `Reference "${ref.originalTemplate}" accesses step metadata. ` +
          `Consider using ".output.data" for the main result.`,
      );
    } else if (cleanDataOrMeta === 'type') {
      // Accessing .output.type is valid (returns 'action', 'llm', etc.)
      return { valid: true, errors, warnings };
    } else {
      // Invalid: trying to access fields directly on output without .data
      // Valid output properties are: data, meta, type
      errors.push(
        `Reference "${ref.originalTemplate}" accesses ".output.${dataOrMeta}" but output only has ` +
          `properties [data, meta, type]. Did you mean "{{steps.${ref.stepSlug}.output.data.${dataOrMeta}}}"?`,
      );
      return { valid: false, errors, warnings };
    }
  }

  return { valid: true, errors, warnings };
}

/**
 * Validate a field path against a schema
 */
function validateFieldPath(
  fieldPath: string[],
  schema: OutputSchema,
  ref: ParsedVariableReference,
  _referencedStep: StepInfo,
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!schema.fields || fieldPath.length === 0) {
    return { valid: true, errors, warnings };
  }

  let currentFields: Record<string, FieldSchema> | undefined = schema.fields;
  const validatedPath: string[] = [];

  for (let i = 0; i < fieldPath.length; i++) {
    const segment = fieldPath[i];

    // Skip if we've lost track of the schema structure
    if (!currentFields) {
      break;
    }

    // Check if this field exists in the current schema level
    if (!(segment in currentFields)) {
      const availableFields = Object.keys(currentFields);
      const pathSoFar = validatedPath.length > 0 ? `.${validatedPath.join('.')}` : '';

      // Check for common mistake: duplicate 'data' in path
      if (segment === 'data' && validatedPath.length === 0) {
        errors.push(
          `Reference "${ref.originalTemplate}" has duplicate "data" in path. ` +
            `Use "{{steps.${ref.stepSlug}.output.data.${fieldPath.slice(i + 1).join('.')}}}" instead of ` +
            `"{{steps.${ref.stepSlug}.output.data.data.${fieldPath.slice(i + 1).join('.')}}}"`,
        );
        return { valid: false, errors, warnings };
      }

      errors.push(
        `Reference "${ref.originalTemplate}" accesses invalid field ".data${pathSoFar}.${segment}". ` +
          `Available fields at this level: [${availableFields.join(', ')}]`,
      );
      return { valid: false, errors, warnings };
    }

    validatedPath.push(segment);
    const fieldSchema: import('./types').FieldSchema = currentFields[segment];

    // If this field has nested fields, update currentFields for next iteration
    if (fieldSchema.type === 'object' && fieldSchema.fields) {
      currentFields = fieldSchema.fields;
    } else if (fieldSchema.type === 'array' && fieldSchema.items?.fields) {
      // For arrays, we'd need index access to go deeper
      if (i + 1 < fieldPath.length) {
        const nextSegment = fieldPath[i + 1];
        const isArrayIndex = /^\[\d+\]$/.test(nextSegment) || /^\d+$/.test(nextSegment);
        if (!isArrayIndex) {
          warnings.push(
            `Reference "${ref.originalTemplate}" accesses ".${nextSegment}" directly on array field "${segment}". ` +
              `Consider using an index like "${segment}[0].${nextSegment}".`,
          );
        }
      }
      currentFields = fieldSchema.items.fields;
    } else {
      // Not an object or array with nested fields, can't traverse further
      currentFields = undefined;
    }
  }

  return { valid: true, errors, warnings };
}

// =============================================================================
// MAIN VALIDATION FUNCTION
// =============================================================================

/**
 * Validate all variable references in a step's configuration
 */
function validateStepVariableReferences(
  step: StepInfo,
  allSteps: Map<string, StepInfo>,
  stepOrder: Map<string, number>,
): ValidateVariableReferencesResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const referenceResults: VariableReferenceValidationResult[] = [];

  // Extract step references from the step config
  const stepRefs = extractStepReferences(step.config);

  for (const ref of stepRefs) {
    const refResult: VariableReferenceValidationResult = {
      valid: true,
      reference: ref,
      errors: [],
      warnings: [],
    };

    // Check if the referenced step exists
    const refStepSlug = ref.stepSlug;
    const referencedStep = refStepSlug ? allSteps.get(refStepSlug) : undefined;

    if (!referencedStep || !refStepSlug) {
      refResult.valid = false;
      refResult.errors.push(
        `Step "${step.stepSlug}" references non-existent step "${ref.stepSlug}" ` +
          `in "${ref.originalTemplate}"`,
      );
      referenceResults.push(refResult);
      errors.push(...refResult.errors);
      continue;
    }

    // Check execution order - can only reference earlier steps
    // refStepSlug is guaranteed to be defined after the check above
    const currentOrder = stepOrder.get(step.stepSlug) ?? Infinity;
    const referencedOrder = stepOrder.get(refStepSlug) ?? -1;

    if (referencedOrder >= currentOrder) {
      refResult.valid = false;
      refResult.errors.push(
        `Step "${step.stepSlug}" (order: ${currentOrder}) references step "${ref.stepSlug}" ` +
          `(order: ${referencedOrder}) which executes at the same time or later. ` +
          `Steps can only reference outputs from earlier steps.`,
      );
      referenceResults.push(refResult);
      errors.push(...refResult.errors);
      continue;
    }

    // Validate path structure
    const pathValidation = validateStepReferencePath(ref, referencedStep);
    refResult.valid = refResult.valid && pathValidation.valid;
    refResult.errors.push(...pathValidation.errors);
    refResult.warnings.push(...pathValidation.warnings);

    referenceResults.push(refResult);
    errors.push(...refResult.errors);
    warnings.push(...refResult.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    references: referenceResults,
  };
}

/**
 * Validate all variable references in a workflow definition
 */
export function validateWorkflowVariableReferences(
  stepsConfig: Array<Record<string, unknown>>,
): ValidateVariableReferencesResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allReferences: VariableReferenceValidationResult[] = [];

  // Build step lookup maps
  const allSteps = new Map<string, StepInfo>();
  const stepOrder = new Map<string, number>();

  for (let i = 0; i < stepsConfig.length; i++) {
    const stepConfig = stepsConfig[i];
    const stepSlug = stepConfig.stepSlug as string;
    const stepType = stepConfig.stepType as StepInfo['stepType'];
    const order = stepConfig.order as number;
    const config = stepConfig.config as Record<string, unknown>;

    if (stepSlug && stepType) {
      const stepInfo: StepInfo = { stepSlug, stepType, order, config };
      allSteps.set(stepSlug, stepInfo);
      stepOrder.set(stepSlug, order);
    } else {
      // Warn about malformed step configurations
      warnings.push(
        `Step at index ${i} is missing required fields (stepSlug: ${!!stepSlug}, stepType: ${!!stepType})`,
      );
    }
  }

  // Validate each step's variable references
  for (const [, step] of allSteps) {
    const result = validateStepVariableReferences(step, allSteps, stepOrder);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    allReferences.push(...result.references);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    references: allReferences,
  };
}
