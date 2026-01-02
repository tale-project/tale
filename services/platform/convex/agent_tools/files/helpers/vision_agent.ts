'use node';

/**
 * Shared helpers for vision model functionality.
 * Provides vision model configuration and agent creation.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../../../_generated/api';
import { openai } from '../../../lib/openai_provider';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_IMAGE_ANALYSIS', '[VisionAgent]');

/**
 * Get the vision model ID from environment variables
 */
export function getVisionModel(): string {
  const visionModel = process.env.OPENAI_VISION_MODEL;
  const mainModel = visionModel || process.env.OPENAI_MODEL;
  if (!mainModel) {
    throw new Error(
      'OPENAI_VISION_MODEL or OPENAI_MODEL environment variable is required',
    );
  }
  return mainModel;
}

/**
 * Creates a vision agent for image analysis
 */
export function createVisionAgent(): Agent {
  const visionModelId = getVisionModel();
  debugLog('Creating vision agent', {
    model: visionModelId,
    baseUrl: process.env.OPENAI_BASE_URL,
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
