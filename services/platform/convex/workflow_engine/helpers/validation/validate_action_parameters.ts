/**
 * Action Parameters Validator
 *
 * Validates action step parameters against the registered action's parametersValidator.
 * This provides early feedback when creating workflows with invalid action configurations.
 *
 * Validates:
 * 1. Action type exists in the registry
 * 2. Operation is valid for the action type
 * 3. Required args for the specific operation are provided
 */

import { getAction, listActionTypes } from '../../action_defs/action_registry';

export interface ActionParametersValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate action parameters against the registered action's parametersValidator
 *
 * @param actionType - The action type (e.g., 'customer', 'document', 'rag')
 * @param parameters - The parameters object from config.parameters (or config itself for legacy format)
 * @returns Validation result with errors and warnings
 */
export function validateActionParameters(
  actionType: string,
  parameters: unknown,
): ActionParametersValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Check if action type exists
  const action = getAction(actionType);
  if (!action) {
    const availableTypes = listActionTypes();
    errors.push(
      `Unknown action type "${actionType}". Available types: ${availableTypes.join(', ')}`,
    );
    return { valid: false, errors, warnings };
  }

  // If action has no parametersValidator, we can't validate further
  const validator = action.parametersValidator;
  if (!validator) {
    warnings.push(
      `Action "${actionType}" has no parametersValidator defined - parameters not validated`,
    );
    return { valid: true, errors, warnings };
  }

  // Check if parameters is an object
  if (parameters === undefined || parameters === null) {
    errors.push(`Action "${actionType}" requires parameters but none provided`);
    return { valid: false, errors, warnings };
  }

  if (typeof parameters !== 'object' || Array.isArray(parameters)) {
    errors.push(`Action "${actionType}" parameters must be an object`);
    return { valid: false, errors, warnings };
  }

  const params = parameters as Record<string, unknown>;

  // Parse the validator structure
  const validatorInfo = parseValidatorStructure(validator);

  if (!validatorInfo) {
    warnings.push(
      `Could not introspect validator for action "${actionType}" - limited validation`,
    );
    return { valid: true, errors, warnings };
  }

  // 2. Validate operation if the action uses operations
  const operation = params.operation as string | undefined;

  if (validatorInfo.validOperations.length > 0) {
    if (!operation) {
      errors.push(
        `Action "${actionType}" requires "operation" field. Valid operations: ${validatorInfo.validOperations.join(', ')}`,
      );
      return { valid: false, errors, warnings };
    }

    if (!validatorInfo.validOperations.includes(operation)) {
      errors.push(
        `Action "${actionType}": Invalid operation "${operation}". Valid operations: ${validatorInfo.validOperations.join(', ')}`,
      );
      return { valid: false, errors, warnings };
    }
  }

  // 3. Validate required fields for the specific operation
  const requiredFields = validatorInfo.getRequiredFieldsForOperation(operation);

  for (const field of requiredFields) {
    if (params[field] === undefined) {
      const opContext = operation ? ` for operation "${operation}"` : '';
      errors.push(
        `Action "${actionType}"${opContext}: Required field "${field}" is missing`,
      );
    }
  }

  // 4. Validate no extra fields at top level
  const allowedFields = validatorInfo.getAllowedFieldsForOperation(operation);
  if (allowedFields.length > 0) {
    const opContext = operation ? ` for operation "${operation}"` : '';
    for (const field of Object.keys(params)) {
      if (!allowedFields.includes(field)) {
        errors.push(
          `Action "${actionType}"${opContext}: Unknown field "${field}". Allowed fields: ${allowedFields.join(', ')}`,
        );
      }
    }
  }

  // 5. Validate no extra fields in nested objects (e.g., updates)
  const nestedObjectFields = validatorInfo.getNestedObjectFields(operation);
  for (const [fieldName, allowedNestedFields] of Object.entries(nestedObjectFields)) {
    const nestedValue = params[fieldName];
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      const opContext = operation ? ` for operation "${operation}"` : '';
      for (const nestedField of Object.keys(nestedValue as Record<string, unknown>)) {
        if (!allowedNestedFields.includes(nestedField)) {
          errors.push(
            `Action "${actionType}"${opContext}: Unknown field "${nestedField}" in "${fieldName}". Allowed fields: ${allowedNestedFields.join(', ')}`,
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// VALIDATOR PARSING
// =============================================================================

interface ValidatorInfo {
  /** List of valid operation values (empty if no operation field) */
  validOperations: string[];
  /** Get required fields for a specific operation (or all required fields if no operation) */
  getRequiredFieldsForOperation: (operation?: string) => string[];
  /** Get allowed fields for a specific operation (all fields including optional ones) */
  getAllowedFieldsForOperation: (operation?: string) => string[];
  /** Get nested object field info for a specific operation */
  getNestedObjectFields: (operation?: string) => Record<string, string[]>;
}

/**
 * Parse a Convex validator to extract operation values and required fields.
 *
 * Handles two patterns:
 * 1. v.object({ operation: v.union(v.literal(...), ...), ... }) - single object with operation union
 * 2. v.union(v.object({ operation: v.literal('op1'), ... }), ...) - union of objects per operation
 */
function parseValidatorStructure(validator: unknown): ValidatorInfo | null {
  const json = (validator as { json?: unknown }).json as
    | Record<string, unknown>
    | undefined;

  if (!json) {
    return null;
  }

  const validatorType = json.type as string | undefined;

  // Pattern 1: v.object({ operation: v.union(...), ... })
  if (validatorType === 'object') {
    return parseObjectValidator(json);
  }

  // Pattern 2: v.union(v.object({ operation: v.literal('x'), ... }), ...)
  if (validatorType === 'union') {
    return parseUnionValidator(json);
  }

  return null;
}

/**
 * Parse a single v.object validator
 */
function parseObjectValidator(
  json: Record<string, unknown>,
): ValidatorInfo | null {
  const fields = json.value as Record<string, unknown> | undefined;
  if (!fields) {
    return null;
  }

  const validOperations: string[] = [];
  const requiredFields: string[] = [];
  const allowedFields: string[] = [];
  const nestedObjectFields: Record<string, string[]> = {};

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    const parsed = parseFieldDefinition(fieldDef);

    if (!parsed) continue;

    // Track all allowed fields
    allowedFields.push(fieldName);

    // Check if this is the operation field with literal values
    if (fieldName === 'operation' && parsed.literalValues.length > 0) {
      validOperations.push(...parsed.literalValues);
    }

    // Track required fields (excluding 'operation' itself)
    if (!parsed.isOptional && fieldName !== 'operation') {
      requiredFields.push(fieldName);
    }

    // Track nested object fields
    if (parsed.allowedFields) {
      nestedObjectFields[fieldName] = parsed.allowedFields;
    }
  }

  return {
    validOperations,
    getRequiredFieldsForOperation: () => requiredFields,
    getAllowedFieldsForOperation: () => allowedFields,
    getNestedObjectFields: () => nestedObjectFields,
  };
}

/**
 * Parse a v.union of v.object validators (discriminated union by operation)
 */
function parseUnionValidator(
  json: Record<string, unknown>,
): ValidatorInfo | null {
  const variants = json.value as unknown[] | undefined;
  if (!variants || !Array.isArray(variants)) {
    return null;
  }

  const validOperations: string[] = [];
  const operationRequiredFields: Record<string, string[]> = {};
  const operationAllowedFields: Record<string, string[]> = {};
  const operationNestedObjectFields: Record<string, Record<string, string[]>> = {};

  for (const variant of variants) {
    const variantJson = variant as { type?: string; value?: Record<string, unknown> };

    if (variantJson.type !== 'object' || !variantJson.value) {
      continue;
    }

    const fields = variantJson.value;
    let variantOperation: string | undefined;
    const variantRequiredFields: string[] = [];
    const variantAllowedFields: string[] = [];
    const variantNestedObjectFields: Record<string, string[]> = {};

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      const parsed = parseFieldDefinition(fieldDef);

      if (!parsed) continue;

      // Track all allowed fields
      variantAllowedFields.push(fieldName);

      // Check if this is the operation field with a literal value
      if (fieldName === 'operation' && parsed.literalValues.length === 1) {
        variantOperation = parsed.literalValues[0];
        validOperations.push(variantOperation);
      }

      // Track required fields (excluding 'operation' itself)
      if (!parsed.isOptional && fieldName !== 'operation') {
        variantRequiredFields.push(fieldName);
      }

      // Track nested object fields
      if (parsed.allowedFields) {
        variantNestedObjectFields[fieldName] = parsed.allowedFields;
      }
    }

    if (variantOperation) {
      operationRequiredFields[variantOperation] = variantRequiredFields;
      operationAllowedFields[variantOperation] = variantAllowedFields;
      operationNestedObjectFields[variantOperation] = variantNestedObjectFields;
    }
  }

  return {
    validOperations,
    getRequiredFieldsForOperation: (operation?: string) => {
      if (operation && operationRequiredFields[operation]) {
        return operationRequiredFields[operation];
      }
      return [];
    },
    getAllowedFieldsForOperation: (operation?: string) => {
      if (operation && operationAllowedFields[operation]) {
        return operationAllowedFields[operation];
      }
      return [];
    },
    getNestedObjectFields: (operation?: string) => {
      if (operation && operationNestedObjectFields[operation]) {
        return operationNestedObjectFields[operation];
      }
      return {};
    },
  };
}

/**
 * Parse a field definition to extract optionality, literal values, and nested object fields
 */
function parseFieldDefinition(
  fieldDef: unknown,
): { isOptional: boolean; literalValues: string[]; allowedFields?: string[] } | null {
  const def = fieldDef as {
    fieldType?: {
      type?: string;
      value?: unknown;
    };
    optional?: boolean;
  };

  if (!def.fieldType) {
    return null;
  }

  // The 'optional' property is at the field level, not in fieldType
  const isOptional = def.optional === true;
  const literalValues: string[] = [];
  let allowedFields: string[] | undefined;

  // Check for literal type
  if (
    def.fieldType.type === 'literal' &&
    typeof def.fieldType.value === 'string'
  ) {
    literalValues.push(def.fieldType.value);
  }

  // Check for union of literals (e.g., operation field)
  if (def.fieldType.type === 'union' && Array.isArray(def.fieldType.value)) {
    for (const variant of def.fieldType.value) {
      const variantDef = variant as { type?: string; value?: string };
      if (variantDef.type === 'literal' && typeof variantDef.value === 'string') {
        literalValues.push(variantDef.value);
      }
    }
  }

  // Check for object type and extract allowed field names
  if (def.fieldType.type === 'object' && def.fieldType.value) {
    const nestedFields = def.fieldType.value as Record<string, unknown>;
    allowedFields = Object.keys(nestedFields);
  }

  return { isOptional, literalValues, allowedFields };
}

