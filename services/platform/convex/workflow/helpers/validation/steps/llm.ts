/**
 * LLM Step Validator
 *
 * Validates LLM step configurations.
 */

import type { ValidationResult } from '../types';

/**
 * Validate an LLM step configuration
 */
export function validateLlmStep(config: Record<string, unknown>): ValidationResult {
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
    errors.push('LLM step requires "name" field');
  }

  if (
    !llmConfig.systemPrompt ||
    typeof llmConfig.systemPrompt !== 'string' ||
    llmConfig.systemPrompt.trim() === ''
  ) {
    errors.push('LLM step requires "systemPrompt" field');
  }

  // Model is now resolved from environment (OPENAI_MODEL) and cannot be
  // customized per step, so we intentionally do not validate a model field.
  // Any provided model value will be ignored at execution time.

  return { valid: errors.length === 0, errors, warnings };
}

