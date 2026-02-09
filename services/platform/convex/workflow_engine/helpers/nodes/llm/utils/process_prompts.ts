/**
 * Process Prompts
 *
 * Validates templates and processes prompts with variable substitution.
 */

import type { NormalizedConfig, ProcessedPrompts } from '../types';

import { replaceVariables } from '../../../../../lib/variables/replace_variables';
import { validateTemplate } from '../../../../../lib/variables/validate_template';

/**
 * Validates templates and processes prompts with variable substitution
 */
export function processPrompts(
  config: NormalizedConfig,
  variables: Record<string, unknown>,
): ProcessedPrompts {
  // Validate templates before processing
  const systemPromptValidation = validateTemplate(config.systemPrompt);
  if (!systemPromptValidation.valid) {
    throw new Error(
      `Invalid system prompt template: ${systemPromptValidation.error}`,
    );
  }

  if (config.userPrompt) {
    const userPromptValidation = validateTemplate(config.userPrompt);
    if (!userPromptValidation.valid) {
      throw new Error(
        `Invalid user prompt template: ${userPromptValidation.error}`,
      );
    }
  }

  // Process template rendering with variable substitution
  const systemPrompt = replaceVariables(config.systemPrompt, variables);
  const userPrompt = config.userPrompt
    ? replaceVariables(config.userPrompt, variables)
    : '';

  // Validate and trim prompts
  const trimmedSystemPrompt =
    typeof systemPrompt === 'string' ? systemPrompt.trim() : '';
  const trimmedUserPrompt =
    typeof userPrompt === 'string' ? userPrompt.trim() : '';

  // Validate that at least one prompt has content
  if (!trimmedSystemPrompt && !trimmedUserPrompt) {
    throw new Error(
      'Both systemPrompt and userPrompt are empty after variable substitution. ' +
        'At least one prompt must have content.',
    );
  }

  // If userPrompt is empty but systemPrompt exists, provide a default prompt
  // This handles cases where NO userPrompt was configured in the step config
  if (!trimmedUserPrompt && trimmedSystemPrompt) {
    return {
      systemPrompt: trimmedSystemPrompt,
      userPrompt:
        'Please proceed with the task described in your instructions.',
      availableSteps: [],
      missingVariables: [],
    };
  }

  return {
    systemPrompt: trimmedSystemPrompt,
    userPrompt: trimmedUserPrompt,
    availableSteps: [],
    missingVariables: [],
  };
}
