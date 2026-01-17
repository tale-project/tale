/**
 * Validate Required Parameters
 *
 * Validates that all required parameters are provided for an operation
 * before creating an approval or executing the operation.
 */

interface ParameterSchema {
  type?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

interface OperationConfig {
  name?: string;
  parametersSchema?: {
    type?: string;
    properties?: Record<string, ParameterSchema>;
    required?: string[];
  };
}

/**
 * Validates that all required parameters are provided and not null/undefined
 *
 * @param operationConfig - The operation configuration with parametersSchema
 * @param params - The actual parameters provided
 * @param operationName - Name of the operation (for error messages)
 * @throws Error if any required parameter is missing or null
 */
export function validateRequiredParameters(
  operationConfig: OperationConfig | null | undefined,
  params: Record<string, unknown>,
  operationName: string,
): void {
  if (!operationConfig?.parametersSchema?.properties) {
    return; // No schema to validate against
  }

  const { properties } = operationConfig.parametersSchema;
  const missingParams: string[] = [];
  const nullParams: string[] = [];

  for (const [paramName, schema] of Object.entries(properties)) {
    // Check if this parameter is required (via the new per-property 'required' field)
    if (schema.required === true) {
      const value = params[paramName];

      // Check if parameter is missing entirely
      if (!(paramName in params)) {
        missingParams.push(paramName);
      }
      // Check if parameter is null or undefined
      else if (value === null || value === undefined) {
        nullParams.push(paramName);
      }
      // Check for empty strings on string types
      else if (schema.type === 'string' && value === '') {
        nullParams.push(paramName);
      }
    }
  }

  // Also check the legacy 'required' array at the schema level (for backward compatibility)
  const legacyRequired = operationConfig.parametersSchema.required || [];
  for (const paramName of legacyRequired) {
    // Skip if already checked via per-property required
    if (properties[paramName]?.required === true) {
      continue;
    }

    const value = params[paramName];
    if (!(paramName in params)) {
      if (!missingParams.includes(paramName)) {
        missingParams.push(paramName);
      }
    } else if (value === null || value === undefined) {
      if (!nullParams.includes(paramName)) {
        nullParams.push(paramName);
      }
    }
  }

  // Build error message if there are issues
  if (missingParams.length > 0 || nullParams.length > 0) {
    const errors: string[] = [];

    if (missingParams.length > 0) {
      errors.push(`Missing required parameters: ${missingParams.join(', ')}`);
    }
    if (nullParams.length > 0) {
      errors.push(
        `Required parameters cannot be null/empty: ${nullParams.join(', ')}`,
      );
    }

    // Build helpful message showing what parameters are expected
    const requiredParamsList = Object.entries(properties)
      .filter(([, schema]) => schema.required === true)
      .map(([name, schema]) => {
        const desc = schema.description ? ` - ${schema.description}` : '';
        return `  • ${name} (${schema.type || 'any'})${desc}`;
      })
      .join('\n');

    throw new Error(
      `Operation "${operationName}" failed validation:\n${errors.join('\n')}\n\n` +
        `Required parameters for this operation:\n${requiredParamsList}`,
    );
  }
}
