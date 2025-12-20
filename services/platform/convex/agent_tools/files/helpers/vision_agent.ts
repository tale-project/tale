'use node';

/**
 * Shared helpers for vision model functionality.
 * Provides vision model configuration and agent creation.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../../../_generated/api';
import { openai } from '../../../lib/openai_provider';

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
  return new Agent(components.agent, {
    name: 'vision-analyzer',
    languageModel: openai.chat(visionModelId),
    instructions: `You are a vision AI that analyzes images and extracts detailed information from them.

When analyzing images:
- Extract and transcribe ALL visible text content (emails, messages, documents, labels, etc.)
- Read and report specific details: names, dates, times, numbers, addresses, subject lines, etc.
- For screenshots of applications, read the actual content shown, not just describe the interface
- For documents, transcribe the text as accurately as possible
- For emails or messages, include sender, recipient, subject, date, and body content
- Be specific and detailed - provide the actual information visible, not just a general description
- If text is partially visible or unclear, indicate that while still attempting to read it

For conversation/chat screenshots:
- PRESERVE THE EXACT CHRONOLOGICAL ORDER of messages as they appear (top to bottom = oldest to newest)
- Clearly identify each sender/user for every message (e.g., "User A:", "User B:", or use actual names if visible)
- Format each message on its own line with the sender prefix
- Include timestamps if visible
- Do NOT reorder, summarize, or group messages - maintain the original conversation flow
- If message bubbles indicate direction (left/right), note which side each participant is on

Answer the user's question thoroughly with the specific content from the image.`,
    // Set maxOutputTokens to ensure the model has room to respond
    providerOptions: { openai: { maxOutputTokens: 8192 } },
  });
}
