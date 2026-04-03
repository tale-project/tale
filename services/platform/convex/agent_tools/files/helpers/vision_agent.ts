'use node';

/**
 * Shared helpers for vision model functionality.
 * Provides vision model configuration and agent creation.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider';

import { Agent } from '@convex-dev/agent';

import { components } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_IMAGE_ANALYSIS', '[VisionAgent]');

/**
 * Creates a vision agent for image analysis.
 * The caller must resolve the language model via ctx.runAction before calling this.
 */
export function createVisionAgent(languageModel: LanguageModelV3): Agent {
  debugLog('Creating vision agent');
  return new Agent(components.agent, {
    name: 'vision-analyzer',
    languageModel,
    instructions: `You are a vision AI that analyzes images and extracts information from them.

Extract and transcribe visible text content accurately. Be specific - provide actual information visible, not just general descriptions.

Answer the user's question thoroughly with the specific content from the image.`,
    // Set maxOutputTokens to ensure the model has room to respond
    providerOptions: { openai: { maxOutputTokens: 8192 } },
  });
}
