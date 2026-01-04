/**
 * LLM Step Validator
 *
 * Validates LLM step configurations.
 */

import { JSONSchemaToZod } from '@dmitryrechkin/json-schema-to-zod';
import type { ValidationResult } from '../types';

/**
 * Validate an LLM step configuration
 */
export function validateLlmStep(
  config: Record<string, unknown>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Support both direct config and { llmNode: config }
  const llmConfig =
    'llmNode' in config && typeof config.llmNode === 'object'
      ? (config.llmNode as Record<string, unknown>)
      : config;

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
    try {
      JSONSchemaToZod.convert(
        llmConfig.outputSchema as Parameters<typeof JSONSchemaToZod.convert>[0],
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`LLM step "outputSchema" is invalid: ${message}`);
    }
  }

  // Model is now resolved from environment (OPENAI_MODEL) and cannot be
  // customized per step, so we intentionally do not validate a model field.
  // Any provided model value will be ignored at execution time.

  return { valid: errors.length === 0, errors, warnings };
}

