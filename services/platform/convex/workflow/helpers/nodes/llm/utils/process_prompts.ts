/**
 * Process Prompts
 *
 * Validates templates and processes prompts with variable substitution.
 */

import { validateTemplate } from '../../../../../lib/variables/validate_template';
import { replaceVariables } from '../../../../../lib/variables/replace_variables';
import type { NormalizedConfig, ProcessedPrompts } from '../types';

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

  return {
    systemPrompt,
    userPrompt,
    availableSteps: [],
    missingVariables: [],
  };
}
