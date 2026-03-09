/**
 * LLM Step Validator
 *
 * Validates LLM step configurations.
 */

import type { ValidationResult } from '../types';

import { isRecord } from '../../../../../lib/utils/type-guards';
import { TOOL_NAMES } from '../../../../agent_tools/tool_names';

const VALID_JSON_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
]);

/**
 * Parse the `type` field from a JSON Schema property.
 * Handles both string (`"string"`) and array-of-types (`["string", "null"]`) syntax.
 */
function parseTypeField(
  prop: Record<string, unknown>,
  path: string,
): { types: string[]; errors: string[] } {
  const typeValue = prop.type;
  if (typeValue == null) {
    return { types: [], errors: [`${path}: missing "type" field`] };
  }

  const raw = Array.isArray(typeValue) ? typeValue : [typeValue];
  const types: string[] = [];
  for (const t of raw) {
    if (typeof t !== 'string') {
      return {
        types: [],
        errors: [`${path}: "type" must be a string or array of strings`],
      };
    }
    types.push(t);
  }

  const invalid = types.filter((t) => !VALID_JSON_SCHEMA_TYPES.has(t));
  if (invalid.length > 0) {
    return {
      types,
      errors: [
        `${path}: invalid type(s) "${invalid.join(', ')}". Must be one of: ${[...VALID_JSON_SCHEMA_TYPES].join(', ')}`,
      ],
    };
  }

  return { types, errors: [] };
}

/**
 * Validate a JSON Schema property structure (recursive).
 * Replaces z.fromJSONSchema() to avoid bundling zod into query files.
 */
function validateJsonSchemaProperty(prop: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!isRecord(prop)) {
    errors.push(`${path}: must be an object`);
    return errors;
  }

  const { types, errors: typeErrors } = parseTypeField(prop, path);
  if (typeErrors.length > 0) {
    return typeErrors;
  }

  if (types.includes('array') && prop.items != null) {
    errors.push(...validateJsonSchemaProperty(prop.items, `${path}.items`));
  }

  if (types.includes('object') && prop.properties != null) {
    if (!isRecord(prop.properties)) {
      errors.push(`${path}.properties: must be an object`);
    } else {
      for (const [key, value] of Object.entries(prop.properties)) {
        errors.push(
          ...validateJsonSchemaProperty(value, `${path}.properties.${key}`),
        );
      }
    }

    if (prop.required != null) {
      if (!Array.isArray(prop.required)) {
        errors.push(`${path}.required: must be an array`);
      } else if (prop.required.some((r: unknown) => typeof r !== 'string')) {
        errors.push(`${path}.required: all entries must be strings`);
      }
    }
  }

  return errors;
}

/**
 * Validate a JSON Schema definition for LLM output.
 * Structural check that the schema is a valid JSON Schema object definition.
 */
function validateJsonSchema(schema: unknown): string[] {
  if (!isRecord(schema)) {
    return ['outputSchema must be an object'];
  }

  if (schema.type !== 'object') {
    return ['outputSchema.type must be "object"'];
  }

  if (!schema.properties || !isRecord(schema.properties)) {
    return ['outputSchema.properties is required and must be an object'];
  }

  const errors: string[] = [];
  for (const [key, value] of Object.entries(schema.properties)) {
    errors.push(
      ...validateJsonSchemaProperty(value, `outputSchema.properties.${key}`),
    );
  }

  if (schema.required != null) {
    if (!Array.isArray(schema.required)) {
      errors.push('outputSchema.required must be an array');
    } else if (schema.required.some((r: unknown) => typeof r !== 'string')) {
      errors.push('outputSchema.required: all entries must be strings');
    }
  }

  return errors;
}

/**
 * Validate an LLM step configuration
 */
export function validateLlmStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Support both direct config and { llmNode: config }
  const llmConfig: Record<string, unknown> =
    'llmNode' in config && isRecord(config.llmNode) ? config.llmNode : config;

  if (!llmConfig || typeof llmConfig !== 'object') {
    errors.push('LLM step requires valid config or llmNode');
    return { valid: false, errors, warnings };
  }

  // Required fields - validate non-empty strings
  if (
    !llmConfig.name ||
    typeof llmConfig.name !== 'string' ||
    llmConfig.name.trim() === ''
  ) {
    errors.push(
      'LLM step requires "name" field. FIX: Add { name: "Descriptive Step Name", systemPrompt: "...", ... }',
    );
  }

  if (
    !llmConfig.systemPrompt ||
    typeof llmConfig.systemPrompt !== 'string' ||
    llmConfig.systemPrompt.trim() === ''
  ) {
    // Check if they used "prompt" instead
    if ('prompt' in llmConfig) {
      errors.push(
        'LLM step requires "systemPrompt" not "prompt". FIX: Rename "prompt" to "systemPrompt"',
      );
    } else {
      errors.push(
        'LLM step requires "systemPrompt" field. FIX: Add { name: "...", systemPrompt: "You are an expert...", userPrompt: "..." }',
      );
    }
  }

  // Validate outputFormat and outputSchema relationship
  const hasOutputSchema =
    'outputSchema' in llmConfig && llmConfig.outputSchema != null;
  const isJsonFormat = llmConfig.outputFormat === 'json';

  if (isJsonFormat && !hasOutputSchema) {
    // JSON output format requires an output schema
    errors.push(
      'LLM step with "outputFormat": "json" requires "outputSchema". FIX: Add outputSchema: { type: "object", properties: {...}, required: [...] }',
    );
  }

  if (hasOutputSchema && !isJsonFormat) {
    // outputSchema requires outputFormat: 'json'
    errors.push(
      'LLM step with "outputSchema" requires "outputFormat": "json". FIX: Add "outputFormat": "json" to config',
    );
  }

  // Validate schema syntax if provided
  if (hasOutputSchema) {
    const schemaErrors = validateJsonSchema(llmConfig.outputSchema);
    for (const err of schemaErrors) {
      errors.push(`LLM step "outputSchema" is invalid: ${err}`);
    }
  }

  // Model is now resolved from environment (OPENAI_MODEL) and cannot be
  // customized per step, so we intentionally do not validate a model field.
  // Any provided model value will be ignored at execution time.

  // Validate tools array if provided
  if ('tools' in llmConfig && llmConfig.tools != null) {
    const tools = llmConfig.tools;
    if (!Array.isArray(tools)) {
      errors.push(
        'LLM step "tools" must be an array of tool names. FIX: Use tools: ["customer_read", "product_read", ...]',
      );
    } else {
      const validToolNames = new Set<string>(TOOL_NAMES);
      const invalidTools = tools.filter(
        (t) => typeof t !== 'string' || !validToolNames.has(t),
      );
      if (invalidTools.length > 0) {
        errors.push(
          `LLM step has invalid tool names: ${JSON.stringify(invalidTools)}. Valid tools are: ${TOOL_NAMES.join(', ')}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
