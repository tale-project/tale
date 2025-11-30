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

  return {
    name: llmConfig.name || 'Workflow LLM',
    systemPrompt: llmConfig.systemPrompt,
    userPrompt: llmConfig.userPrompt || '',
    // Model is controlled via the OPENAI_MODEL environment variable. We do not
    // provide a fallback model: OPENAI_MODEL must be set explicitly in the
    // Convex environment or LLM workflow steps will fail to run.
    model: envModel,
    temperature: llmConfig.temperature ?? 0.2,
    maxTokens: llmConfig.maxTokens ?? 512,
    maxSteps: llmConfig.maxSteps ?? 10, // Default to 10 steps for tool calling
    outputFormat: llmConfig.outputFormat,
    tools: llmConfig.tools,
    mcpServerIds: llmConfig.mcpServerIds,
    contextVariables: llmConfig.contextVariables,
  };
}
