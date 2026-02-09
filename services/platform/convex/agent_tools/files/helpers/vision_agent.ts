'use node';

/**
 * Shared helpers for vision model functionality.
 * Provides vision model configuration and agent creation.
 */

import { Agent } from '@convex-dev/agent';

import { components } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { getEnvOrThrow, getEnvOptional } from '../../../lib/get_or_throw';
import { openai } from '../../../lib/openai_provider';

const debugLog = createDebugLog('DEBUG_IMAGE_ANALYSIS', '[VisionAgent]');

/**
 * Get the vision model ID from environment variables
 */
export function getVisionModel(): string {
  const visionModel = getEnvOptional('OPENAI_VISION_MODEL');
  if (visionModel) {
    return visionModel;
  }
  return getEnvOrThrow(
    'OPENAI_MODEL',
    'Vision model or default model - required for image analysis',
  );
}

/**
 * Creates a vision agent for image analysis
 */
export function createVisionAgent(): Agent {
  const visionModelId = getVisionModel();
  debugLog('Creating vision agent', {
    model: visionModelId,
    baseUrl: getEnvOptional('OPENAI_BASE_URL'),
  });
  return new Agent(components.agent, {
    name: 'vision-analyzer',
    languageModel: openai.chat(visionModelId),
    instructions: `You are a vision AI that analyzes images and extracts information from them.

Extract and transcribe visible text content accurately. Be specific - provide actual information visible, not just general descriptions.

Answer the user's question thoroughly with the specific content from the image.`,
    // Set maxOutputTokens to ensure the model has room to respond
    providerOptions: { openai: { maxOutputTokens: 8192 } },
  });
}
