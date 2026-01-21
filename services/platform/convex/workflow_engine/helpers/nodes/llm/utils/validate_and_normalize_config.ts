/**
 * Validate and Normalize Config
 *
 * Validates and normalizes the LLM node configuration.
 */

import type { LLMNodeConfig } from '../../../../types/nodes';
import type { NormalizedConfig } from '../types';

/**
 * Validates and normalizes the LLM node configuration
 */
export function validateAndNormalizeConfig(
  rawConfig: LLMNodeConfig | { llmNode: LLMNodeConfig },
): NormalizedConfig {
  // Support both shapes: config.llmNode or config itself
  const llmConfig: LLMNodeConfig =
    'llmNode' in rawConfig ? rawConfig.llmNode : rawConfig;

  if (!llmConfig || !llmConfig.systemPrompt) {
    throw new Error('Invalid LLM node configuration: systemPrompt is required');
  }

  const envModel = (process.env.OPENAI_MODEL || '').trim();
  if (!envModel) {
    throw new Error(
      'OPENAI_MODEL environment variable is required for LLM workflow steps but is not set',
    );
  }

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

  return {
    name: llmConfig.name || 'Workflow LLM',
    systemPrompt: llmConfig.systemPrompt,
    userPrompt: llmConfig.userPrompt || '',
    // Model is controlled via the OPENAI_MODEL environment variable. We do not
    // provide a fallback model: OPENAI_MODEL must be set explicitly in the
    // Convex environment or LLM workflow steps will fail to run.
    model: envModel,
    // Note: The following are intentionally not configurable in workflow definitions:
    // - maxTokens: uses model's default value
    // - maxSteps: defaults to 40 when tools are configured (see createAgentConfig)
    // - temperature: auto-determined based on outputFormat (json→0.2, text→0.5)
    outputFormat: llmConfig.outputFormat,
    outputSchema: llmConfig.outputSchema,
    tools: llmConfig.tools,
    contextVariables: llmConfig.contextVariables,
  };
}
