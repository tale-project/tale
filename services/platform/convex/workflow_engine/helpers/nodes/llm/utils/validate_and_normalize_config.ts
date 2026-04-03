/**
 * Validate and Normalize Config
 *
 * Validates and normalizes the LLM node configuration.
 */

import type { LLMNodeConfig } from '../../../../types/nodes';
import type { NormalizedConfig } from '../types';

/**
 * Validates and normalizes the LLM node configuration.
 *
 * Model resolution is deferred to the action layer: the caller passes a
 * `defaultModel` string that was resolved via the provider file_actions.
 */
export function validateAndNormalizeConfig(
  rawConfig: LLMNodeConfig | { llmNode: LLMNodeConfig },
  defaultModel?: string,
): NormalizedConfig {
  // Support both shapes: config.llmNode or config itself
  const llmConfig: LLMNodeConfig =
    'llmNode' in rawConfig ? rawConfig.llmNode : rawConfig;

  if (!llmConfig || !llmConfig.systemPrompt) {
    throw new Error('Invalid LLM node configuration: systemPrompt is required');
  }

  if (!defaultModel) {
    throw new Error(
      'Invalid LLM node configuration: defaultModel must be provided by the caller',
    );
  }

  const envModel = defaultModel;

  // Validate outputSchema if provided
  if (llmConfig.outputSchema) {
    if (llmConfig.outputFormat !== 'json') {
      throw new Error(
        'Invalid LLM node configuration: outputSchema requires outputFormat to be "json"',
      );
    }
    if (
      !llmConfig.outputSchema.type ||
      llmConfig.outputSchema.type !== 'object'
    ) {
      throw new Error(
        'Invalid LLM node configuration: outputSchema must have type "object"',
      );
    }
    if (
      !llmConfig.outputSchema.properties ||
      typeof llmConfig.outputSchema.properties !== 'object'
    ) {
      throw new Error(
        'Invalid LLM node configuration: outputSchema must have properties defined',
      );
    }
  }

  // Disallow tools + json output combination
  if (
    llmConfig.outputFormat === 'json' &&
    llmConfig.tools &&
    llmConfig.tools.length > 0
  ) {
    throw new Error(
      'Invalid LLM node configuration: cannot use both tools and outputFormat "json". ' +
        'Split into two LLM steps.',
    );
  }

  return {
    name: llmConfig.name || 'Workflow LLM',
    systemPrompt: llmConfig.systemPrompt,
    userPrompt: llmConfig.userPrompt || '',
    // Model is resolved from provider configuration files. We do not provide a
    // fallback model: a valid provider config must exist or LLM workflow steps
    // will fail to run.
    model: envModel,
    // Note: The following are intentionally not configurable in workflow definitions:
    // - maxTokens: uses model's default value
    // - maxSteps: defaults to 40 when tools are configured (see createAgentConfig)
    // - temperature: auto-determined based on outputFormat (json→0.2, text→0.5)
    outputFormat: llmConfig.outputFormat,
    outputSchema: llmConfig.outputSchema,
    tools: llmConfig.tools,
    knowledgeFileIds: llmConfig.knowledgeFileIds,
    contextVariables: llmConfig.contextVariables,
  };
}
