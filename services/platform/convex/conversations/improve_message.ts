import type { LanguageModelV3 } from '@ai-sdk/provider';

import { Agent } from '@convex-dev/agent';

import type { ActionCtx } from '../_generated/server';

import { components } from '../_generated/api';

function createImproveMessageAgent(
  languageModel: LanguageModelV3,
  instruction?: string,
) {
  return new Agent(components.agent, {
    name: 'message-improver',
    languageModel,
    instructions: `You are a helpful assistant that improves written messages for clarity, professionalism, and tone.
Your task is to improve the given message while keeping its core meaning intact.
${instruction ? `Additional instruction: ${instruction}` : ''}

Guidelines:
- Maintain the original intent and key points
- Improve grammar, spelling, and punctuation
- Make the tone professional yet friendly
- Keep the message concise but complete
- Return only the improved message without any explanation`,
  });
}

export async function improveMessage(
  ctx: ActionCtx,
  args: {
    originalMessage: string;
    instruction?: string;
    languageModel: LanguageModelV3;
  },
): Promise<{ improvedMessage: string; error?: string }> {
  try {
    const agent = createImproveMessageAgent(
      args.languageModel,
      args.instruction,
    );
    const userId = `improve-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const result = await agent.generateText(
      ctx,
      { userId },
      { prompt: args.originalMessage },
      { storageOptions: { saveMessages: 'none' } },
    );

    return { improvedMessage: result.text || args.originalMessage };
  } catch (error) {
    console.error('[improveMessage] Error:', error);
    return {
      improvedMessage: args.originalMessage,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
